const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config');
const { migrate } = require('./db/migrate');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const healthRoutes = require('./features/health/health.routes');
const usersRoutes = require('./features/users/users.routes');
const projectsRoutes = require('./features/projects/projects.routes');
const tasksRoutes = require('./features/tasks/tasks.routes');
const filesRoutes = require('./features/files/files.routes');
const promptsRoutes = require('./features/prompts/prompts.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: config.cors.origin }));
app.use(express.json());
if (config.env !== 'test') {
  app.use(morgan('short'));
}

app.use('/api/health', healthRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/prompts', promptsRoutes);

app.use(notFound);
app.use(errorHandler);

function start() {
  console.log('Running database migrations…');
  migrate();

  app.listen(config.port, () => {
    console.log(`Backend listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
