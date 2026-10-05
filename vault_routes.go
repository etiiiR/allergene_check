package main

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"
)

const maxVaultEnvelopeBytes = 16 << 20

type putVaultRequest struct {
	ExpectedRevision *int64          `json:"expected_revision"`
	Envelope         json.RawMessage `json:"envelope"`
}

// registerVaultRoutes exposes only an opaque JSON envelope. It does not
// replace or disable the legacy plaintext diary routes; that cutover must
// happen together with the client-side vault migration.
func registerVaultRoutes(api fiber.Router, repository VaultRepository) {
	api.Get("/vault", func(c *fiber.Ctx) error {
		vault, err := repository.LoadVault(c.UserContext())
		if err != nil {
			return err
		}
		return c.JSON(vault)
	})

	api.Put("/vault", func(c *fiber.Ctx) error {
		var request putVaultRequest
		if err := c.BodyParser(&request); err != nil || request.ExpectedRevision == nil || *request.ExpectedRevision < 0 {
			return invalid("Der Tresor-Auftrag ist ungültig.")
		}
		if len(request.Envelope) == 0 || len(request.Envelope) > maxVaultEnvelopeBytes {
			return invalid("Der verschlüsselte Tresor ist leer oder zu gross.")
		}
		var envelope map[string]json.RawMessage
		if err := json.Unmarshal(request.Envelope, &envelope); err != nil || envelope == nil {
			return invalid("Der verschlüsselte Tresor muss ein JSON-Objekt sein.")
		}
		vault, err := repository.SaveVault(c.UserContext(), *request.ExpectedRevision, request.Envelope)
		if err != nil {
			return err
		}
		return c.JSON(vault)
	})
}
