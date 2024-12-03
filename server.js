const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
const port = 3004;

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...allowedOrigins.map(origin => origin.replace(/^https?/, 'ws'))],
    },
  },
}));

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

db.connect(err => {
  if (err) return;
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get('/random-user', (req, res) => {
  const query = 'SELECT id, username, mail FROM usuarios ORDER BY RAND() LIMIT 1';
  db.query(query, (err, results) => {
    if (err) return res.status(500).end();
    if (results.length > 0) {
      res.json({
        id: results[0].id,
        username: results[0].username,
        mail: results[0].mail
      });
    } else {
      res.status(404).end();
    }
  });
});

app.get('/tipo-alerta', (req, res) => {
  const query = 'SELECT id, descripcion FROM tipo_alerta';
  db.query(query, (err, results) => {
    if (err) return res.status(500).end();
    res.json(results);
  });
});

app.post('/trigger-panic-button', (req, res) => {
  const { id_usuario, latitud, longitud } = req.body;
  if (!id_usuario) return res.status(400).end();

  const id_tipo = 8;
  const estado = 1;

  const insertQuery = `
    INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url, id_georeferencia, id_sirena, estado, feedback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [id_usuario, id_tipo, null, latitud, longitud, null, null, null, estado, null];
  
  db.query(insertQuery, values, (insertErr, insertResults) => {
    if (insertErr) return res.status(500).end();
    res.json({ id: insertResults.insertId });
  });
});

app.post('/send-alert', upload.single('foto'), (req, res) => {
  try {
    const { id_usuario, id_tipo, mensaje, latitud, longitud } = req.body;
    const foto = req.file ? req.file : null;

    if (foto) {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          transformation: [
            { width: 800, height: 600, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) return res.status(500).end();

          const foto_url = result.secure_url;
          const sql = `INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url) 
                       VALUES (?, ?, ?, ?, ?, ?)`;
          db.query(sql, [id_usuario, id_tipo, mensaje, latitud, longitud, foto_url], (err) => {
            if (err) return res.status(500).end();
            res.json({ foto_url });
          });
        }
      ).end(foto.buffer);
    } else {
      const sql = `INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url) 
                   VALUES (?, ?, ?, ?, ?, ?)`;
      db.query(sql, [id_usuario, id_tipo, mensaje, latitud, longitud, null], (err) => {
        if (err) return res.status(500).end();
        res.json({ foto_url: null });
      });
    }
  } catch {
    res.status(500).end();
  }
});

server.listen(port);
