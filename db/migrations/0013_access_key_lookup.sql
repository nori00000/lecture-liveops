-- Access key O(1) lookup support.
-- New keys store an 8-character plaintext lookup prefix; the secret remains bcrypt-hashed.

alter table access_keys
  add column if not exists key_prefix text;

create index if not exists access_keys_key_prefix_idx
  on access_keys(key_prefix)
  where key_prefix is not null;
