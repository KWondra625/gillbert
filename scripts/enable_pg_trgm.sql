-- One-time: enables trigram-based fuzzy text matching (similarity(), % operator),
-- used by the reworked Catch Chat fish species lookup to catch typos/near-misses
-- against both Active and Inactive species before falling back to "Other".
CREATE EXTENSION IF NOT EXISTS pg_trgm;
