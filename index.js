const express = require('express');
const {
  search,
  downloadTrack2,
  downloadAlbum2
} = require("@nechlophomeriaa/spotifydl");
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de middleware para seguridad y logging
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// Middleware para manejo de errores
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: false,
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

// Función para subir archivo MP3 a tmpfiles.org sin guardar en disco
async function uploadToTmpFiles(mp3Buffer, fileName) {
  try {
    // Crear formulario para la subida
    const form = new FormData();
    form.append('file', mp3Buffer, {
      filename: fileName,
      contentType: 'audio/mpeg'
    });

    // Subir a tmpfiles.org
    const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
      headers: form.getHeaders()
    });

    // Validar respuesta
    if (response.data.status === 'success' && response.data.data.url) {
      return response.data.data.url;
    } else {
      throw new Error('Respuesta inválida de tmpfiles.org');
    }
  } catch (error) {
    console.error('Error al subir a tmpfiles.org:', error.message);
    throw error;
  }
}

// Endpoint para buscar canciones
app.get('/api/buscar', async (req, res, next) => {
  try {
    const { query, limit = 5 } = req.query;
    
    if (!query) {
      return res.status(400).json({
        status: false,
        message: 'El parámetro query es requerido'
      });
    }

    const searchResults = await search(query, parseInt(limit));
    
    res.json({
      status: true,
      data: searchResults,
      message: 'Búsqueda realizada con éxito'
    });
  } catch (error) {
    next(error);
  }
});

// Endpoint para descargar una canción
app.get('/api/descargar/cancion', async (req, res, next) => {
  try {
    const { url, query } = req.query;
    
    // Validar parámetros
    if (!url && !query) {
      return res.status(400).json({
        status: false,
        message: 'Se requiere el parámetro url o query'
      });
    }
    if (url && query) {
      return res.status(400).json({
        status: false,
        message: 'Proporcione solo uno: url o query'
      });
    }

    let trackUrl = url;
    if (query) {
      const searchResults = await search(query, 10);
      if (!searchResults || searchResults.length === 0) {
        return res.status(404).json({
          status: false,
          message: 'No se encontraron resultados para la búsqueda'
        });
      }
      trackUrl = searchResults[0].url;
    }

    const trackData = await downloadTrack2(trackUrl);
    
    // Subir el archivo MP3 a tmpfiles.org
    let downloadUrl = null;
    if (trackData.audioBuffer) {
      const fileName = `${trackData.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
      downloadUrl = await uploadToTmpFiles(trackData.audioBuffer, fileName);
      // Eliminar audioBuffer de la respuesta para reducir tamaño
      delete trackData.audioBuffer;
    }

    res.json({
      status: true,
      data: {
        ...trackData,
        downloadUrl
      },
      message: query ? 'Canción encontrada, descargada y subida con éxito' : 'Canción descargada y subida con éxito'
    });
  } catch (error) {
    next(error);
  }
});

// Endpoint para descargar un álbum
app.get('/api/descargar/album', async (req, res, next) => {
  try {
    const { url, query } = req.query;
    
    // Validar parámetros
    if (!url && !query) {
      return res.status(400).json({
        status: false,
        message: 'Se requiere el parámetro url o query'
      });
    }
    if (url && query) {
      return res.status(400).json({
        status: false,
        message: 'Proporcione solo uno: url o query'
      });
    }

    let albumUrl = url;
    if (query) {
      const searchResults = await search(query, 10);
      if (!searchResults || searchResults.length === 0) {
        return res.status(404).json({
          status: false,
          message: 'No se encontraron resultados para la búsqueda'
        });
      }
      // Buscar el primer resultado que sea un álbum o playlist
      const albumResult = searchResults.find(result => result.album && (result.album.type === 'album' || result.album.type === 'playlist'));
      if (!albumResult) {
        return res.status(404).json({
          status: false,
          message: 'No se encontraron álbumes o playlists en los resultados de búsqueda'
        });
      }
      albumUrl = albumResult.url;
    }

    const albumData = await downloadAlbum2(albumUrl);
    
    // Subir cada pista a tmpfiles.org
    if (albumData.trackList) {
      albumData.trackList = await Promise.all(albumData.trackList.map(async (track, index) => {
        if (track.audioBuffer) {
          const fileName = `${albumData.metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}_track_${index + 1}.mp3`;
          const downloadUrl = await uploadToTmpFiles(track.audioBuffer, fileName);
          // Eliminar audioBuffer de la respuesta
          delete track.audioBuffer;
          return { ...track, downloadUrl };
        }
        return track;
      }));
    }

    res.json({
      status: true,
      data: albumData,
      message: query ? 'Álbum encontrado, descargado y subida con éxito' : 'Álbum descargado y subida con éxito'
    });
  } catch (error) {
    next(error);
  }
});

// Ruta para verificar el переда del servidor
app.get('/api/health', (req, res) => {
  res.json({
    status: true,
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: 'Ruta no encontrada'
  });
});

// Usar el middleware de manejo de errores
app.use(errorHandler);

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

// Manejo de errores no capturados
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', duly);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada no manejada:', err);
});
