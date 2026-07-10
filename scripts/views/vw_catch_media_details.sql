CREATE OR REPLACE VIEW vw_catch_media_details AS
    SELECT cm.id AS id,
           c.catch_number AS catch_number,
           cm.blob_path AS blob_path,
           cm.read_url AS read_url,
           cm.original_filename AS original_filename,
           cm.media_type AS media_type,
           cm.content_type AS content_type,
           cm.file_size_bytes AS file_size_bytes,
           cm.uploaded_at AS uploaded_at,
           cm.uploaded_by_angler_id AS uploaded_by_angler_id,
           a.name as uploaded_by_angler_name,
           cm.created_at AS created_at,
           cm.updated_at AS updated_at
    FROM catch_media cm INNER JOIN catches c ON cm.catch_id = c.id
           LEFT JOIN anglers a ON cm.uploaded_by_angler_id = a.id
    ORDER BY cm.id;