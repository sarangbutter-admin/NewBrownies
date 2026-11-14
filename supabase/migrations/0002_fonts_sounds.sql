-- Let the "media" bucket accept the owner's custom fonts (.woff2 .woff .ttf .otf) and sounds (.mp3 .wav .ogg) as well as photos and videos.
-- Without this, Supabase refuses those uploads and the shop shows "Something went wrong on the server."
update storage.buckets
set allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','image/gif',
      'video/mp4','video/webm','video/quicktime',
      'font/woff2','font/woff','font/ttf','font/otf',
      'audio/mpeg','audio/wav','audio/x-wav','audio/wave','audio/ogg'],
    file_size_limit = 4718592
where id = 'media';
