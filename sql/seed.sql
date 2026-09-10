INSERT INTO readers (name, color)
VALUES
  ('Oumar', '#7b4a2d'),
  ('Kana', '#315f72')
ON CONFLICT (name) DO UPDATE
SET color = EXCLUDED.color;
