// =============================================================================
// Media Upload & Management Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/connection');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');

const MEDIA_PATH = process.env.MEDIA_STORAGE_PATH || '/var/media';

// Países suportados no descobridor de música + termos de pesquisa "semente"
// usados quando o utilizador só escolhe um país (sem termo de pesquisa livre).
const COUNTRIES = {
  AO: { name: 'Angola', flag: '🇦🇴', seeds: ['kizomba', 'semba angola', 'kuduro angola', 'afro house angola'] },
  BR: { name: 'Brasil', flag: '🇧🇷', seeds: ['mpb', 'sertanejo', 'funk brasileiro', 'pagode', 'samba'] },
  PT: { name: 'Portugal', flag: '🇵🇹', seeds: ['fado', 'pop português', 'música portuguesa'] },
  US: { name: 'Estados Unidos', flag: '🇺🇸', seeds: ['pop hits', 'american top 40', 'hip hop usa'] },
  ES: { name: 'Espanha', flag: '🇪🇸', seeds: ['pop español', 'flamenco pop', 'reggaeton español'] },
  ZA: { name: 'África do Sul', flag: '🇿🇦', seeds: ['amapiano', 'afro house south africa', 'gqom'] },
  MZ: { name: 'Moçambique', flag: '🇲🇿', seeds: ['marrabenta', 'pandza moçambique', 'afro house moçambique'] },
  CV: { name: 'Cabo Verde', flag: '🇨🇻', seeds: ['morna', 'coladeira cabo verde', 'funaná'] }
};

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || 'music';
    const dest = path.join(MEDIA_PATH, type);
    fs.mkdir(dest, { recursive: true }).then(() => cb(null, dest)).catch(cb);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = uuidv4() + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.ogg', '.flac', '.wav', '.aac', '.m4a', '.opus'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed`));
    }
  }
});

// POST /api/media/upload - Upload media file(s)
router.post('/upload', authenticate, authorize('admin', 'manager', 'dj'), upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const type = req.body.type || 'music';
    const country = (req.body.country || '').toUpperCase().slice(0, 2) || null;
    const overrideTitle = (req.body.title || '').trim();
    const overrideArtist = (req.body.artist || '').trim();
    const results = [];

    for (const file of req.files) {
      // Try to extract metadata
      let metadata = {};
      try {
        const mm = await import('music-metadata');
        const parsed = await mm.parseFile(file.path);
        metadata = {
          title: parsed.common.title || path.basename(file.originalname, path.extname(file.originalname)),
          artist: parsed.common.artist || 'Unknown',
          album: parsed.common.album || '',
          genre: parsed.common.genre?.[0] || '',
          year: parsed.common.year || null,
          duration: parsed.format.duration || null,
          bitrate: parsed.format.bitrate ? Math.round(parsed.format.bitrate / 1000) : null,
          sample_rate: parsed.format.sampleRate || null,
          channels: parsed.format.numberOfChannels || 2
        };
      } catch (metaErr) {
        logger.warn(`Could not parse metadata for ${file.originalname}:`, metaErr.message);
        metadata = {
          title: path.basename(file.originalname, path.extname(file.originalname)),
          artist: 'Unknown'
        };
      }

      if (overrideTitle) metadata.title = overrideTitle;
      if (overrideArtist) metadata.artist = overrideArtist;

      const result = await query(
        `INSERT INTO media_files (filename, original_name, file_path, file_size, duration, format,
         bitrate, sample_rate, channels, title, artist, album, genre, year, type, country, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          file.filename, file.originalname, file.path, file.size,
          metadata.duration, path.extname(file.originalname).substring(1),
          metadata.bitrate, metadata.sample_rate, metadata.channels,
          metadata.title, metadata.artist, metadata.album,
          metadata.genre, metadata.year, type, country, req.user.id
        ]
      );

      results.push(result.rows[0]);
    }

    logger.info(`${results.length} files uploaded by ${req.user.username}`);
    res.status(201).json({ uploaded: results.length, files: results });
  } catch (error) {
    logger.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// GET /api/media/countries - Lista de países suportados no descobridor
router.get('/countries', authenticate, (req, res) => {
  const list = Object.entries(COUNTRIES).map(([code, c]) => ({ code, name: c.name, flag: c.flag }));
  res.json({ countries: list });
});

// GET /api/media/discover - Pesquisa artistas/músicas num catálogo externo (Deezer),
// com destaque para os países da lusofonia e diáspora. Não faz download de ficheiros
// completos (apenas metadados + excerto de 30s), por respeito aos direitos de autor.
router.get('/discover', authenticate, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const countryCode = String(req.query.country || '').toUpperCase();
    const countryInfo = COUNTRIES[countryCode];

    if (!q && !countryInfo) {
      return res.status(400).json({ error: 'Indica um termo de pesquisa ou escolhe um país' });
    }

    let searchTerm = q;
    if (countryInfo) {
      const seed = countryInfo.seeds[Math.floor(Math.random() * countryInfo.seeds.length)];
      searchTerm = q ? `${q} ${seed}` : seed;
    }

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&limit=25`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      throw new Error(`Catálogo externo respondeu ${response.status}`);
    }

    const data = await response.json();
    const results = (data.data || []).map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist?.name || 'Desconhecido',
      album: t.album?.title || '',
      cover: t.album?.cover_medium || t.album?.cover || '',
      preview: t.preview || '',
      duration: t.duration || 0,
      link: t.link || ''
    }));

    res.json({
      query: searchTerm,
      country: countryInfo ? { code: countryCode, name: countryInfo.name, flag: countryInfo.flag } : null,
      results
    });
  } catch (error) {
    logger.error('Media discover error:', error);
    res.status(502).json({ error: 'Falha ao pesquisar catálogo externo. Tenta novamente.' });
  }
});

// GET /api/media - List media files
router.get('/', authenticate, async (req, res) => {
  try {
    const { type, page = 1, limit = 50, search, country } = req.query;
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      whereClause += ` AND type = $${params.length}`;
    }

    if (country) {
      params.push(String(country).toUpperCase());
      whereClause += ` AND country = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (title ILIKE $${params.length} OR artist ILIKE $${params.length} OR original_name ILIKE $${params.length})`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM media_files ${whereClause}`, params
    );

    params.push(limit, offset);
    const result = await query(
      `SELECT * FROM media_files ${whereClause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      files: result.rows
    });
  } catch (error) {
    logger.error('Get media error:', error);
    res.status(500).json({ error: 'Failed to fetch media files' });
  }
});

// GET /api/media/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM media_files WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch media file' });
  }
});

// PUT /api/media/:id - Update metadata
router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { title, artist, album, genre, type } = req.body;
    const country = req.body.country !== undefined
      ? (String(req.body.country || '').toUpperCase().slice(0, 2) || null)
      : undefined;
    const result = await query(
      `UPDATE media_files SET title = COALESCE($1, title), artist = COALESCE($2, artist),
       album = COALESCE($3, album), genre = COALESCE($4, genre), type = COALESCE($5, type),
       country = CASE WHEN $6::boolean THEN $7 ELSE country END
       WHERE id = $8 RETURNING *`,
      [title, artist, album, genre, type, country !== undefined, country, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update media file' });
  }
});

// DELETE /api/media/:id
router.delete('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const result = await query('SELECT * FROM media_files WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media file not found' });
    }

    // Delete physical file
    try {
      await fs.unlink(result.rows[0].file_path);
    } catch (fsErr) {
      logger.warn('Could not delete physical file:', fsErr.message);
    }

    await query('DELETE FROM media_files WHERE id = $1', [req.params.id]);
    res.json({ message: 'Media file deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete media file' });
  }
});

module.exports = router;
