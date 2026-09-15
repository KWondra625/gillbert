CREATE TABLE IF NOT EXISTS anglers (
    id SERIAL PRIMARY KEY,
    name varchar(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Active', 'Inactive')),
    aliases varchar(255)[],
    login_emails varchar(255)[],
    groups varchar(255)[],
    profile_photo_blob_path varchar(255),
    profile_photo_read_url varchar(255),
    profile_photo_uploaded_at timestamptz,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);