CREATE TABLE IF NOT EXISTS fish_species (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    aliases varchar(255)[],
    notes TEXT, 
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);