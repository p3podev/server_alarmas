const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const http = require("http");
const socketIo = require("socket.io");
const helmet = require("helmet");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const port = 3004;

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [
          "'self'",
          ...allowedOrigins.map((origin) => origin.replace(/^https?/, "ws")),
        ],
      },
    },
  })
);

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

db.connect((err) => {
  if (err) return;
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get("/random-user", (req, res) => {
  const query =
    "SELECT id, username, mail FROM usuarios ORDER BY RAND() LIMIT 1";
  db.query(query, (err, results) => {
    if (err) return res.status(500).end();
    if (results.length > 0) {
      res.json({
        id: results[0].id,
        username: results[0].username,
        mail: results[0].mail,
      });
    } else {
      res.status(404).end();
    }
  });
});

app.get("/tipo-alerta", (req, res) => {
  const query = "SELECT id, descripcion FROM tipo_alerta";
  db.query(query, (err, results) => {
    if (err) return res.status(500).end();
    res.json(results);
  });
});

app.post("/trigger-panic-button", (req, res) => {
  const { id_usuario, latitud, longitud } = req.body;
  if (!id_usuario) return res.status(400).end();

  const id_tipo = 8;
  const estado = 1;

  const insertQuery = `
    INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url, id_georeferencia, id_sirena, estado, feedback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    id_usuario,
    id_tipo,
    null,
    latitud,
    longitud,
    null,
    null,
    null,
    estado,
    null,
  ];

  db.query(insertQuery, values, (insertErr, insertResults) => {
    if (insertErr) return res.status(500).end();
    res.json({ id: insertResults.insertId });
  });
});

app.post("/send-alert", upload.single("foto"), (req, res) => {
  try {
    const { id_usuario, id_tipo, mensaje, latitud, longitud } = req.body;
    const foto = req.file ? req.file : null;

    if (foto) {
      cloudinary.uploader
        .upload_stream(
          {
            resource_type: "image",
            transformation: [
              { width: 800, height: 600, crop: "limit" },
              { quality: "auto" },
              { fetch_format: "auto" },
            ],
          },
          (error, result) => {
            if (error) return res.status(500).end();

            const foto_url = result.secure_url;
            const sql = `INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url) 
                       VALUES (?, ?, ?, ?, ?, ?)`;
            db.query(
              sql,
              [id_usuario, id_tipo, mensaje, latitud, longitud, foto_url],
              (err) => {
                if (err) return res.status(500).end();
                res.json({ foto_url });
              }
            );
          }
        )
        .end(foto.buffer);
    } else {
      const sql = `INSERT INTO alarmas (id_usuario, id_tipo, mensaje, latitud, longitud, foto_url) 
                   VALUES (?, ?, ?, ?, ?, ?)`;
      db.query(
        sql,
        [id_usuario, id_tipo, mensaje, latitud, longitud, null],
        (err) => {
          if (err) return res.status(500).end();
          res.json({ foto_url: null });
        }
      );
    }
  } catch {
    res.status(500).end();
  }
});
app.get("/active-alarms", (req, res) => {
  const query = `
    SELECT 
      alarmas.id AS id_alarma,
      usuarios.Nombre AS nombre_usuario,
      usuarios.Apellido AS apellido_usuario,
      usuarios.rol AS rol_usuario,
      georeferencias.descripcion AS descripcion_georeferencia,
      tipo_alerta.descripcion AS descripcion_tipo_alerta,
      DATE_FORMAT(alarmas.timestamp, '%Y-%m-%d %H:%i:%s') AS fecha
    FROM alarmas
    JOIN usuarios ON alarmas.id_usuario = usuarios.id
    LEFT JOIN georeferencias ON alarmas.id_georeferencia = georeferencias.id
    JOIN tipo_alerta ON alarmas.id_tipo = tipo_alerta.id
    WHERE alarmas.estado = 1
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Error al consultar las alarmas activas." });
    }
    res.json(results);
  });
});
app.get("/alarmas/:id", (req, res) => {
  const alarmaId = req.params.id; // Obtenemos el ID de la alarma desde los parámetros de la ruta.

  const query = `
    SELECT 
      alarmas.id AS id_alarma,
      alarmas.mensaje,
      alarmas.latitud,
      alarmas.longitud,
      alarmas.foto_url,
      usuarios.Nombre AS nombre_usuario,
      usuarios.Apellido AS apellido_usuario,
      usuarios.telefono AS telefono_usuario,
      usuarios.rol AS rol_usuario,
      usuarios.dependencia AS dependencia_usuario,
      georeferencias.descripcion AS descripcion_georeferencia,
      tipo_alerta.descripcion AS descripcion_tipo_alerta,
      DATE_FORMAT(alarmas.timestamp, '%Y-%m-%d %H:%i:%s') AS fecha
    FROM alarmas
    JOIN usuarios ON alarmas.id_usuario = usuarios.id
    LEFT JOIN georeferencias ON alarmas.id_georeferencia = georeferencias.id
    JOIN tipo_alerta ON alarmas.id_tipo = tipo_alerta.id
    WHERE alarmas.id = ?; -- Filtro por ID de alarma
  `;

  db.query(query, [alarmaId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al consultar la alarma." });
    }

    if (results.length === 0) {
      return res
        .status(404)
        .json({ error: "No se encontró la alarma con el ID especificado." });
    }

    res.json(results[0]); // Retorna solo el objeto de la alarma específica.
  });
});

app.post("/sirena_2/:id", (req, res) => {
  const { estado } = req.body; // Estado que se va a actualizar
  const id = req.params.id; // El id de la sirena que se pasa en la URL

  // Validación: Asegúrate de que 'estado' sea 0 o 1
  if (estado !== 0 && estado !== 1) {
    return res.status(400).json({ error: "Estado debe ser 0 o 1" });
  }

  // Consulta para actualizar el estado en la tabla sirenas
  const updateSirenaQuery = `
    UPDATE sirenas 
    SET estado = ? 
    WHERE id = 2
  `;

  db.query(updateSirenaQuery, [estado, id], (err, result) => {
    if (err) {
      return res.status(500).json({ error: "Error interno del servidor" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Sirena no encontrada" });
    }

    // Consulta para actualizar la tabla alarmas con id_sirena = 2
    const updateAlarmaQuery = `
      UPDATE alarmas 
      SET id_sirena = 2
      WHERE id = ?
    `;

    db.query(updateAlarmaQuery, [id], (alarmaErr, alarmaResult) => {
      if (alarmaErr) {
        return res.status(500).json({ error: "Error al actualizar alarmas" });
      }

      res.json({
        message: `Estado de la sirena con ID ${id} actualizado y alarmas asociadas actualizadas`,
      });
    });
  });
});
app.post("/feedback/:id", (req, res) => {
  const idAlarma = req.params.id;
  const { feedback } = req.body; // Esperamos el campo feedback en lugar de respuesta

  // Verificar que el feedback no sea vacío
  if (!feedback || feedback.trim() === "") {
    return res.status(400).json({ error: "El feedback no puede estar vacío" });
  }

  // Actualizar el feedback en la base de datos
  const query = "UPDATE alarmas SET feedback = ? WHERE id = ?";
  db.query(query, [feedback, idAlarma], (err, results) => {
    if (err) {
      console.error("Error al actualizar el feedback de la alarma:", err);
      return res.status(500).json({ error: "Error al actualizar el feedback" });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: "Alarma no encontrada" });
    }

    return res
      .status(200)
      .json({ message: "Feedback de la alarma actualizado correctamente" });
  });
});

// Ruta para actualizar el estado de la alarma
app.post("/estado/:id", (req, res) => {
  const idAlarma = req.params.id;
  const { estado } = req.body; // estado debe ser 0 o 1

  // Verificar si el estado es 0 o 1
  if (![0, 1].includes(estado)) {
    return res.status(400).json({ error: "El estado debe ser 0 o 1" });
  }

  // Actualizar el estado de la alarma en la base de datos
  const query = "UPDATE alarmas SET estado = ? WHERE id = ?";
  db.query(query, [estado, idAlarma], (err, results) => {
    // Cambio aquí
    if (err) {
      console.error("Error al actualizar el estado de la alarma:", err);
      return res.status(500).json({ error: "Error al actualizar el estado" });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: "Alarma no encontrada" });
    }

    return res
      .status(200)
      .json({ message: "Estado de la alarma actualizado correctamente" });
  });
});

app.get("/ultima-alerta", (req, res) => {
  const query = `
    SELECT 
      alarmas.id AS id_alarma,
      alarmas.mensaje,
      alarmas.latitud,
      alarmas.longitud,
      alarmas.foto_url,
      usuarios.Nombre AS nombre_usuario,
      usuarios.Apellido AS apellido_usuario,
      usuarios.telefono AS telefono_usuario,
      usuarios.rol AS rol_usuario,
      usuarios.dependencia AS dependencia_usuario,
      georeferencias.descripcion AS descripcion_georeferencia,
      tipo_alerta.descripcion AS descripcion_tipo_alerta,
      DATE_FORMAT(alarmas.timestamp, '%Y-%m-%d %H:%i:%s') AS fecha
    FROM alarmas
    JOIN usuarios ON alarmas.id_usuario = usuarios.id
    LEFT JOIN georeferencias ON alarmas.id_georeferencia = georeferencias.id
    JOIN tipo_alerta ON alarmas.id_tipo = tipo_alerta.id
    ORDER BY alarmas.timestamp DESC
    LIMIT 1; -- Obtenemos la última alerta por timestamp
  `;

  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Error al consultar la última alerta." });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No se encontraron alertas." });
    }

    res.json(results[0]); // Retorna la última alerta
  });
});
app.get("/random-admin", (req, res) => {
  const query = "SELECT id, username, mail FROM admin ORDER BY RAND() LIMIT 1";
  db.query(query, (err, results) => {
    if (err) return res.status(500).end();
    if (results.length > 0) {
      res.json({
        id: results[0].id,
        username: results[0].username,
        mail: results[0].mail,
      });
    } else {
      res.status(404).end();
    }
  });
});

server.listen(port);
