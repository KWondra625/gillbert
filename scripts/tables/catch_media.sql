CREATE TABLE IF NOT EXISTS catch_media (
    id SERIAL PRIMARY KEY,
    catch_id INT NOT NULL REFERENCES catches(id),
    blob_path varchar(255) NOT NULL,
    read_url varchar(255) NOT NULL,
    original_filename varchar(255) NOT NULL,
    media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('Photo', 'Video')),
    content_type varchar(255) NOT NULL,
    file_size_bytes INT NOT NULL,
    uploaded_by_angler_id INT REFERENCES anglers(id),
    uploaded_at TIMESTAMPTZ,
    status varchar(20) NOT NULL DEFAULT 'complete'
        CHECK (status IN ('submitted', 'processing', 'complete', 'failed')),
    error_message text,
    status_updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);