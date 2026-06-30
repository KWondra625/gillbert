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
    verified_at TIMESTAMPTZ, 
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION generate_catch_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.catch_number := 'Catch ' || TO_CHAR(
    COALESCE(NEW.caught_when, NOW()), 
    'YY'
  ) || '-' || LPAD(NEW.id::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_catch_number
BEFORE INSERT ON catches
FOR EACH ROW
EXECUTE FUNCTION generate_catch_number();