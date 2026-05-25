CREATE TABLE IF NOT EXISTS catches (
    id SERIAL PRIMARY KEY,
    catch_number varchar(50),
    status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    record_source varchar(255) NOT NULL,
    angler_id INT NOT NULL REFERENCES anglers(id),
    fish_species_id INT NOT NULL REFERENCES fish_species(id),
    body_of_water_id INT NOT NULL REFERENCES bodies_of_water(id),
    caught_when TIMESTAMPTZ,
    length_in_inches FLOAT,
    water_depth_in_feet FLOAT,
    notes TEXT,
    conversation_id INT REFERENCES conversations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);