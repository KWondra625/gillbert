CREATE TABLE IF NOT EXISTS fish_species (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    aliases varchar(255)[],
    display_name_override varchar(255),
    family_display_name varchar(255),
    family_scientific_name varchar(255),
    dnr_url varchar(500),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);