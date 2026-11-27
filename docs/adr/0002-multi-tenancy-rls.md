# ADR 0002: Multi tenancy rls

Status: Proposed

Every business table has organization_id. PostgreSQL row-level security is the second line of defense: each request sets the tenant in the database session. Cross-organization work (customer, carrier) happens through transport_participant rows with role and visibility scope, never through data copies. A two-organization isolation test is required for every new table.
