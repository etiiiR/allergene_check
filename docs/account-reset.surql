-- Account sign-in recovery only. Never add diary_vault or legacy diary tables here.
BEGIN TRANSACTION;
DELETE FROM diary_account_sessions;
DELETE diary_account:owner;
COMMIT TRANSACTION;
