/**
 * ISARI Init Import Script
 * =========================
 *
 * Script loading the initial data for ISARI by merging various data sources
 * such as CSV files and converting them to be inserted into the Mongo
 * database.
 */
const async = require('async'),
      csv = require('csv'),
      fs = require('fs'),
      path = require('path'),
      yargs = require('yargs'),
      mongoose = require('../../server/node_modules/mongoose'),
      inspect = require('util').inspect,
      chalk = require('chalk');

const FILES = require('./files'),
      clean = require('./clean'),
      helpers = require('./helpers'),
      log = require('./logger')();

if (inspect.defaultOptions)
  inspect.defaultOptions.depth = null;

// Altering the NODE_CONFIG_DIR env variable so that `config` can resolve
process.env.NODE_CONFIG_DIR = path.join(__dirname, '..', '..', 'server', 'config');

const {
  connect,
  People,
  Organization,
  Activity
} = require('../../server/lib/model');

// Creating relations iteration helpers
const relations = {
  Organization: helpers.processRelations.bind(null,
    helpers.findRelations(Organization.schema)
  ),
  People: helpers.processRelations.bind(null,
    helpers.findRelations(People.schema)
  ),
  Activity: helpers.processRelations.bind(null,
    helpers.findRelations(Activity.schema)
  )
};

/**
 * Command line & constants.
 * -----------------------------------------------------------------------------
 */

/**
 * Reading command line.
 */
const argv = yargs
  .usage('$0 --path ./path/to/isari_data')
  .option('path', {
    demand: true
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Whether to perform a dry run.'
  })
  .option('json', {
    describe: 'JSON dump path.'
  })
  .help()
  .argv;

/**
 * Indexes.
 */
const INDEXES = {
  Organization: {
    acronym: Object.create(null),
    name: Object.create(null),
    id: Object.create(null)
  },
  People: {
    id: Object.create(null)
  }
};

/**
 * State.
 */
let NB_ERRORS = 0,
    NB_FILES = 0;

/**
 * Helpers.
 * -----------------------------------------------------------------------------
 */

// Function taking a parsed CSV line and cleaning it.
function cleanLine(line) {
  for (const k in line)
    line[k] = clean.default(line[k]);
}

// Function attributing a mongo id to an arbitrary item
function attachMongoId(item) {
  item._id = mongoose.Types.ObjectId();
}

// Function taking a file descriptor and returning the parsed lines
function parseFile(folder, file, callback) {
  const filePath = path.join(
    argv.path,
    folder,
    file.path
  );

  NB_FILES++;

  console.log();
  log.info(`Reading ${chalk.cyan(filePath)}`);

  const options = {
    delimiter: file.delimiter,
    columns: true
  };

  const data = fs.readFileSync(filePath, 'utf-8');

  return csv.parse(data, options, (err, lines) => {
    if (err)
      return callback(err);

    log.info(`Parsed ${chalk.cyan(lines.length)} lines.`);

    // Cleaning the lines
    lines.forEach(cleanLine);

    // Consuming the lines
    lines = lines.map(file.consumer.bind(log));

    // Dropping null values
    lines.forEach((line, index) => {
      for (const k in line) {
        const value = line[k];

        if (
          value === null ||
          value === undefined ||
          value === '' ||
          Array.isArray(value) && !value.length
        )
          delete line[k];

        if (Number.isNaN(value))
          log.error(`Line ${index + 1}: NaN value for ${chalk.cyan(k)}`);
      }
    });

    return callback(null, lines);
  });
}

// Function using the Mongoose models to validate an entity
function validate(Model, line, index) {
  const result = (new Model(line, false)).validateSync(),
        errors = [];

  if (!result)
    return errors;

  return helpers.collectErrors(result, index);
}

/**
 * Tasks (Organizations, People, Activities)
 * -----------------------------------------------------------------------------
 */

/**
 * Processing organization files.
 */
const organizationTasks = FILES.organizations.files.map(file => next => {
  parseFile(FILES.organizations.folder, file, (err, lines) => {
    if (err)
      return next(err);

    // Giving unique identifier
    lines.forEach(attachMongoId);

    // Validating
    lines.forEach((line, i) => {
      const errors = validate(Organization, line, i);

      errors.forEach(error => {
        log.error(error.formattedMessage, error);
      });

      NB_ERRORS += errors.length;
    });

    // Indexing
    lines.forEach(file.indexer.bind(null, INDEXES.Organization));

    return next();
  });
});

/**
 * Processing people files.
 */
const peopleTasks = FILES.people.files.map(file => next => {
  parseFile(FILES.people.folder, file, (err, lines) => {
    if (err)
      return next(err);

    const persons = file.resolver.call(log, lines);

    log.info(`Extracted ${chalk.cyan(persons.length)} persons.`);

    // Validating
    persons.forEach((person, i) => {
      const errors = validate(People, person, i);

      errors.forEach(error => {
        log.error(error.formattedMessage, error);
      });

      NB_ERRORS += errors.length;
    });

    // Giving unique identifier
    persons.forEach(attachMongoId);

    // Indexing
    persons.forEach(file.indexer.bind(null, INDEXES.People));

    return next();
  });
});

/**
 * Process outline.
 * -----------------------------------------------------------------------------
 */
log.info('Starting...');
async.series({
  organizations(next) {
    log.success('Processing organization files...');
    return async.series(organizationTasks, next);
  },
  people(next) {
    console.log();
    log.success('Processing people files...');
    return async.series(peopleTasks, next);
  },
  relations(next) {
    const nbOrganization = Object.keys(INDEXES.Organization.id).length,
          nbPeople = Object.keys(INDEXES.People.id).length;

    console.log();
    log.success(`Finished processing ${chalk.cyan(NB_FILES)} files!`);
    log.info(`Collected ${chalk.cyan(nbOrganization)} unique organizations.`);
    log.info(`Collected ${chalk.cyan(nbPeople)} unique people.`);

    return next();
  }
}, err => {
  if (err)
    return console.error(err);

  console.log();
  if (NB_ERRORS) {
    log.error(`${NB_ERRORS} total errors.`);
    log.error('Files were erroneous. Importation was not done. Please fix and import again.');
  }
  else {
    log.success('Done!');
  }
});
