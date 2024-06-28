const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config(); // Cargar variables de entorno desde .env

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
const port = 3004;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configuración de la conexión a MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

db.connect(err => {
  if (err) {
    console.error('Error conectando a la base de datos:', err);
    return;
  }
  console.log('Conexión a la base de datos MySQL establecida.');
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Ruta para recibir datos del formulario y almacenar en la base de datos
app.post('/alerta', upload.single('foto'), (req, res) => {
  const { usuario, tipoAlerta, mensaje, latitud, longitud } = req.body;

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
      if (error) {
        console.error('Error subiendo a Cloudinary:', error);
        res.status(500).send('Error al subir la imagen.');
        return;
      }

      const foto_url = result.secure_url;

      const query = 'INSERT INTO notificaciones (usuario, tipoAlerta, mensaje, latitud, longitud, foto_url, estado) VALUES (?, ?, ?, ?, ?, ?, "activo")';
      db.query(query, [usuario, tipoAlerta, mensaje, latitud, longitud, foto_url], (err, result) => {
        if (err) {
          console.error('Error ejecutando la consulta:', err);
          res.status(500).send('Error al guardar la alerta.');
          return;
        }

        const newAlertId = result.insertId;
        const newAlert = { id: newAlertId, usuario, tipoAlerta, mensaje, latitud, longitud, foto_url, timestamp: new Date() };
        io.emit('new-alert', newAlert);

        res.status(200).json({ id: newAlertId, message: 'Alerta guardada exitosamente.', newAlert });
      });
    }
  ).end(req.file.buffer);
});

// Ruta para actualizar una notificación y marcarla como inactiva
app.put('/notificaciones/:id/inactivar', (req, res) => {
  const { id } = req.params;
  const { feedback } = req.body;

  if (!id) {
    return res.status(400).send('Error: ID de notificación no proporcionado.');
  }

  const query = 'UPDATE notificaciones SET estado = "inactivo", feedback = ? WHERE id = ?';

  db.query(query, [feedback, id], (err, result) => {
    if (err) {
      console.error('Error ejecutando la consulta:', err);
      return res.status(500).send('Error al actualizar la notificación.');
    }

    const getUpdatedNotificationQuery = 'SELECT estado, feedback FROM notificaciones WHERE id = ?';
    db.query(getUpdatedNotificationQuery, [id], (err, results) => {
      if (err) {
        console.error('Error ejecutando la consulta:', err);
        return res.status(500).send('Error al obtener la notificación actualizada.');
      }

      const updatedNotification = results[0];
      io.emit('alert-resolved', updatedNotification);

      res.status(200).send('Notificación actualizada exitosamente.');
    });
  });
});

// Ruta para obtener una notificación específica por su ID
app.get('/notificaciones/:id', (req, res) => {
  const { id } = req.params;

  const query = 'SELECT estado, feedback FROM notificaciones WHERE id = ?';
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error('Error ejecutando la consulta:', err);
      return res.status(500).send('Error al obtener la notificación.');
    }

    if (results.length === 0) {
      return res.status(404).send('Notificación no encontrada.');
    }

    const notification = results[0];
    res.status(200).json(notification);
  });
});

server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

