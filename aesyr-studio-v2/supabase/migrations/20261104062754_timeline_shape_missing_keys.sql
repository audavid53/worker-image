-- Fix: timelines_doc_shape let a document with a *missing* key through, because
-- jsonb_typeof(NULL) is NULL and a NULL check result passes. Treat missing as invalid.
alter table public.timelines drop constraint timelines_doc_shape;
alter table public.timelines add constraint timelines_doc_shape check (
  jsonb_typeof(doc) = 'object'
  and coalesce(jsonb_typeof(doc -> 'tracks'), '') = 'array'
  and coalesce(jsonb_typeof(doc -> 'clips'), '') = 'array'
  and coalesce(jsonb_typeof(doc -> 'markers'), '') = 'array'
);
