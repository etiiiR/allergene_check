package main

import (
	"errors"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
)

const (
	ErrorCodeInternal              = "internal_error"
	ErrorCodeDatabaseUnavailable   = "database_unavailable"
	ErrorCodeDatabaseNotConfigured = "database_not_configured"
	ErrorCodeInvalidTable          = "invalid_table_name"
	ErrorCodeLiveQuery             = "live_query_error"
	ErrorCodeStartup               = "startup_error"
)

// ErrorMessage is the stable, client-safe error payload shared by HTTP and WebSocket responses.
type ErrorMessage struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorResponse is the standard envelope returned for failed requests.
type ErrorResponse struct {
	Error ErrorMessage `json:"error"`
}

// AppError carries an HTTP status, stable public code/message, and an optional internal cause.
// The cause is available for logs and errors.Is/errors.As but is never serialized to clients.
type AppError struct {
	Status  int
	Code    string
	Message string
	Cause   error
}

// Error implements error while retaining the internal cause for server-side logs.
func (e *AppError) Error() string {
	if e == nil {
		return ""
	}
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

// Unwrap exposes the internal cause to errors.Is and errors.As.
func (e *AppError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// NewAppError creates a client-safe application error without an internal cause.
func NewAppError(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}

// WrapAppError creates a client-safe application error around an internal cause.
func WrapAppError(status int, code, message string, cause error) *AppError {
	return &AppError{Status: status, Code: code, Message: message, Cause: cause}
}

// NormalizeError converts Fiber and unknown errors into the standard application error type.
func NormalizeError(err error) *AppError {
	if err == nil {
		return nil
	}

	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr
	}

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		return WrapAppError(fiberErr.Code, "http_error", fiberErr.Message, err)
	}

	return WrapAppError(fiber.StatusInternalServerError, ErrorCodeInternal, "internal server error", err)
}

// AppErrorHandler is the global Fiber error handler for consistent HTTP responses.
func AppErrorHandler(c *fiber.Ctx, err error) error {
	appErr := NormalizeError(err)
	if appErr.Status >= fiber.StatusInternalServerError {
		// Internal causes may contain query or request details. Keep logs useful
		// for triage without recording sensitive values or raw database errors.
		log.Printf("request %s %s failed (%s)", c.Method(), c.Path(), appErr.Code)
	}

	return c.Status(appErr.Status).JSON(ErrorResponse{
		Error: ErrorMessage{Code: appErr.Code, Message: appErr.Message},
	})
}

// ErrorResponseFor converts any error into the standard response envelope.
func ErrorResponseFor(err error) ErrorResponse {
	appErr := NormalizeError(err)
	return ErrorResponse{Error: ErrorMessage{Code: appErr.Code, Message: appErr.Message}}
}

// ErrDatabaseNotConfigured is returned when a database helper has no client.
var ErrDatabaseNotConfigured = NewAppError(fiber.StatusServiceUnavailable, ErrorCodeDatabaseNotConfigured, "SurrealDB is not configured")

// ErrTransactionNil is returned when a transaction lifecycle method gets nil.
var ErrTransactionNil = NewAppError(fiber.StatusInternalServerError, ErrorCodeInternal, "transaction is nil")

// ErrTransactionCallbackNil is returned when WithTransaction has no callback.
var ErrTransactionCallbackNil = NewAppError(fiber.StatusInternalServerError, ErrorCodeInternal, "transaction callback is required")
