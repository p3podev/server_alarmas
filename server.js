const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer'); // Importar multer
const cloudinary = require('cloudinary').v2;
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
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

// Configurar helmet con las políticas CSP adecuadas
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://server.p3po.dev", "https://server.p3po.dev", "ws://server.p3po.dev", "wss://server.p3po.dev"],
    },
  },
}));

// Configurar CORS para permitir solicitudes desde alarmas.p3po.dev y dashboard.p3po.dev
app.use(cors({
  origin: ['https://alarmas.p3po.dev', 'https://dashboard.p3po.dev'],
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'], // Incluye PUT y OPTIONS aquí
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware para manejar las solicitudes OPTIONS
app.options('*', cors());

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

// Configuración de Multer para manejar la carga de archivos
const storage = multer.memoryStorage(); // Almacenar en memoria (puedes cambiar a almacenamiento en disco según tus necesidades)
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Ajustar el límite de tamaño según sea necesario
});

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

      const query = 'INSERT INTO Alarmas (usuario, tipoAlerta, mensaje, latitud, longitud, foto_url, estado) VALUES (?, ?, ?, ?, ?, ?, "activo")';
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

  const query = 'UPDATE Alarmas SET estado = "inactivo", feedback = ? WHERE id = ?';

  db.query(query, [feedback, id], (err, result) => {
    if (err) {
      console.error('Error ejecutando la consulta:', err);
      return res.status(500).send('Error al actualizar la notificación.');
    }

    const getUpdatedNotificationQuery = 'SELECT estado, feedback FROM Alarmas WHERE id = ?';
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

  const query = 'SELECT estado, feedback FROM Alarmas WHERE id = ?';
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
