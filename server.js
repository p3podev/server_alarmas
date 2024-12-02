const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const http = require('http');
const socketIo = require('socket.io');
const helmet = require('helmet');
const { exec } = require('child_process'); // Importar exec para ejecutar scripts
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

// Leer orígenes permitidos desde variables de entorno
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');

// Configurar helmet con las políticas CSP adecuadas
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", ...allowedOrigins.map(origin => origin.replace(/^https?/, 'ws'))],
    },
  },
}));

// Configurar CORS para permitir solicitudes desde orígenes permitidos
app.use(cors({
  origin: '*'/*allowedOrigins*/, // Change on Deploy
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Endpoint para obtener un usuario aleatorio
app.get('/random-user', (req, res) => {
  const query = 'SELECT id, username, mail FROM usuarios ORDER BY RAND() LIMIT 1';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener usuario aleatorio:', err);
      return res.status(500).send('Error al obtener usuario aleatorio');
    }
    if (results.length > 0) {
      console.log('Usuario aleatorio:', results[0]); // Agregar este log para depuración
      res.json({
        id: results[0].id,
        username: results[0].username,
        mail: results[0].mail
      });
    } else {
      res.status(404).send('No se encontraron usuarios');
    }
  });
});



// Endpoint para obtener los tipos de alerta
app.get('/tipo-alerta', (req, res) => {
  const query = 'SELECT id, descripcion FROM tipo_alerta';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener tipos de alerta:', err);
      return res.status(500).send('Error al obtener tipos de alerta');
    }
    res.json(results); // Enviar las descripciones de tipo_alerta al frontend
  });
});
app.post('/create-alert', (req, res) => {
  const { id_usuario, latitud, longitud } = req.body;

  // Verificar si el id_usuario fue enviado correctamente
  if (!id_usuario) {
    return res.status(400).send('ID de usuario es requerido');
  }

  const id_tipo = 8; // Tipo de alerta predefinido
  const estado = 'activo'; // Estado predeterminado

  // Insertar nueva alerta
  const insertQuery = `
    INSERT INTO alarmas (
      id_usuario, id_tipo, mensaje, latitud, longitud, foto_url, id_georeferencia, id_sirena, estado, feedback
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    id_usuario,
    id_tipo,
    null, // mensaje
    latitud,
    longitud,
    null, // foto_url
    null, // id_georeferencia
    null, // id_sirena
    estado,
    null, // feedback
  ];

  db.query(insertQuery, values, (insertErr, insertResults) => {
    if (insertErr) {
      console.error('Error al insertar alerta:', insertErr);
      return res.status(500).send('Error al crear alerta');
    }

    res.json({ message: 'Alerta creada con éxito', id: insertResults.insertId });
  });
});


server.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
