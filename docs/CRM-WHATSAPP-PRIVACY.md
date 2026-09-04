# CRM data handling notes

This private CRM contains customer contact information and case-management notes. Keep it behind the authenticated `/crm` route and never copy `data/crm.db`, CRM backups, access tokens, passwords, or WhatsApp secrets into `public/`, Git commits, screenshots, logs, or issue comments.

Operational rules:

- use a unique CRM password and rotate it if exposed;
- keep `CRM_SESSION_SECRET`, `CRM_INTEGRATION_KEY`, Meta App Secret and access tokens only in Plesk environment variables;
- use the official WhatsApp Business Platform / Cloud API webhook;
- obtain and record the customer's WhatsApp opt-in where required;
- do not use unofficial browser automation to bypass WhatsApp restrictions;
- download an off-server CRM JSON backup periodically; same-server backups protect against accidental edits but not loss of the hosting account itself;
- after connecting WhatsApp, retain only data needed for client service and business records and define an internal retention policy.
