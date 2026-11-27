# ADR 0009: Integration layer

Status: Accepted

External systems (SAP, other ERP/TMS, telematics, EDI, email, CSV) are connected through adapters with their own mapping. External data is never written straight into core models. Use idempotency keys, an external_ref table and sync_run logs. Inbound uses an inbox pattern, outbound webhooks use an outbox. The SAP connector starts against labeled mock responses and goes live only with a test system and approvals.
