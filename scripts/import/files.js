/**
 * ISARI Import Scripts File Definitions
 * ======================================
 *
 * Defining the various files to import as well as their line consumers.
 */
const moment = require('moment'),
      chalk = require('chalk'),
      fingerprint = require('talisman/keyers/fingerprint').default,
      _ = require('lodash');

const ENUM_INDEXES = require('./indexes.js').ENUM_INDEXES;

/**
 * Overriding some Moment.js things for convenience.
 */
moment.prototype.inspect = function() {
  return 'Moment{' + this.format('YYYY-MM-DD') + '}';
};
moment.prototype.toString = moment.prototype.inspect;

/**
 * Helpers.
 */
function partitionBy(collection, predicate) {
  return _.values(_.groupBy(collection, predicate));
}

/**
 * File definitions.
 */
module.exports = {

  /**
   * Organization Files.
   * ---------------------------------------------------------------------------
   */
  organizations: {
    folder: 'organizations',
    files: [

      /**
       * default_organizations.csv
       */
      {
        name: 'default',
        path: 'default_organizations.csv',
        delimiter: ',',
        consumer(line) {
          const info = {
            name: line.name,
            address: line.address,
            countries: [line.country],
            status: line.status,
            organizationTypes: [line.organizationType]
          };

          if (line.acronym)
            info.acronym = line.acronym;
          if (line.url)
            info.url = line.url;
          if (line.parent_organisations)
            line.parentOrganizations = [line.parent_organisations];

          return info;
        },
        indexer(indexes, org) {
          if (org.acronym)
            indexes.acronym[org.acronym] = org;

          if (org.name) {
            indexes.name[org.name] = org;
            indexes.fingerprint[fingerprint(org.name)] = org;
          }

          indexes.id[org._id] = org;
        }
      },

      /**
       * sciencespo_research_units.csv
       */
      {
        name: 'research_units',
        path: 'sciencespo_research_units.csv',
        delimiter: ',',
        consumer(line) {
          let researchUnitCodes = [];

          if (line.researchUnitCodes) {
            researchUnitCodes = JSON.parse(line.researchUnitCodes);
          }

          // Normalizing dates
          researchUnitCodes.forEach(item => {
            item.startDate = moment(item.startDate, 'DD/MM/YYYY').format('YYYY-MM-DD');
            if (item.endDate)
              item.endDate = moment(item.endDate, 'DD/MM/YYYY').format('YYYY-MM-DD');
          });

          const info = {
            researchUnitCodes,
            name: line.name,
            address: line.address,
            url: line.url,
            status: line.status,
            countries: ['FR']
          };

          if (line.acronym)
            info.acronym = line.acronym;

          if (line.idRnsr)
            info.idRnsr = line.idRnsr;

          if (line.parentOrganizations)
            info.parentOrganizations = line.parentOrganizations.split(',');

          if (line.idScopus)
            info.idScopus = line.idScopus;

          if (line.organizationTypes)
            info.organizationTypes = line.organizationTypes.split(',');

          return info;
        },
        indexer(indexes, org) {
          if (org.acronym)
            indexes.acronym[org.acronym] = org;

          if (org.name) {
            indexes.name[org.name] = org;
            indexes.fingerprint[fingerprint(org.name)] = org;
          }

          indexes.id[org._id] = org;
        }
      },

      /**
       * organizations_hceres_banner_spire.csv
       */
      {
        name: 'organizations_hceres_banner_spire',
        path: 'organizations_hceres_banner_spire.csv',
        delimiter: ',',
        skip: true,
        consumer(line) {
          const info = {
            source: line.Source,
            HCERESorganizationType: line['TAGS HCERES'],
            codeUAI: line['code UAI'],
            acronym: line.Sigle,
            name: line['Nom d\'usage 1'],
            country: line['Country ISO'],
            idBanner: line['ID Banner'],
            address: line['ADRESSE BANNER'] || line['ADRESSE SPIRE'],
            idSpire: line['SPIRE rec_id'],
            organizationType: line['organizationType (ENUMS)'],
            parentOrganization: line['SPIRE ORGA Parent REC ID'],
            researchUnitCodes: [],
            idHal: line['SPIRE ID hal']
          };

          if (line['Country ISO'])
            line.countries = [line['Country ISO']];

          if (line['SPIRE ID cnrs'])
            info.researchUnitCodes.push({code: line['SPIRE ID cnrs']});

          if (line['SPIRE ID ministry'])
            info.researchUnitCodes.push({code: line['SPIRE ID ministry']});

          return info;
        },
        resolver(lines) {

          // Here we're gonna merge lines internally to this file
          // TODO: choose the keying method
          const organizations = partitionBy(lines, line => `${line.acronym}§${line.name}`);

          // 1) country européen
          // 2) intra banner duplicates
          // 3) intra spire duplicates
          // let pb = organizations.filter(o => partitionBy(o, 'source').some(s => s.length > 1));

          // require('fs').writeFileSync('pb.json', JSON.stringify(pb, null, 2));

          // console.log(organizations.filter(o => o.filter(i => i.source === 'Banner').length > 1).length)

          return lines;
        },
        indexer() {

        }
      }
    ]
  },

  /**
   * People Files.
   * ---------------------------------------------------------------------------
   */
  people: {
    folder: 'people',
    files: [

      /**
       * SIRH.csv
       */
      {
        name: 'sirh',
        path: 'SIRH.csv',
        delimiter: ',',
        consumer(line, index) {
          const info = {
            year: line.Année,
            name: line['Nom usuel'],
            firstName: line.Prénom,
            birthName: line['Nom de naissance'],
            sirhMatricule: line.Matricule,
            birthDate: line['Date de naissance'],
            gender: line.gender,
            startDate: moment(line['Date de début'], 'YYYY-MM-DD'),
            jobType: line['Type de contrat'],
            gradeSirh: line['Emploi Repère'],
            jobName: line['Emploi Personnalisé'],
            academicMembership: line.Affiliation
          };

          if (line['%ETP'])
            info.timepart = +line['%ETP'].replace(/,/g, '.');

          let nationality = line.Nationalité;

          if (nationality) {
            nationality = ENUM_INDEXES.countries.alpha3[nationality];

            if (!nationality)
              this.error(`Line ${index + 1}: unknown nationality ${chalk.cyan(line.Nationalité)}`);
            else
              info.nationality = nationality.alpha2;
          }

          // Handling endDate
          let endDate;

          if (line['Date fin présumée'] && line['Date de sortie adm'])
            endDate = moment.min(
              moment(line['Date fin présumée'], 'YYYY-MM-DD'),
              moment(line['Date de sortie adm'], 'YYYY-MM-DD')
            );
          else if (line['Date fin présumée'])
            endDate = moment(line['Date fin présumée'], 'YYYY-MM-DD');
          else if (line['Date de sortie adm'])
            endDate = moment(line['Date de sortie adm'], 'YYYY-MM-DD');

          if (endDate)
            info.endDate = endDate;

          return info;
        },
        resolver(lines) {

          // First we need to group the person by matricule
          let persons = partitionBy(lines, 'sirhMatricule');

          // Sorting lines by year
          persons = persons.map(years => {
            return _.sortBy(years, 'year');
          });

          // Creating people objects
          // .filter(p => p[0].name === 'OLIVIER')
          const objects = persons.map(years => {
            const first = years[0],
                  last = years[years.length - 1];

            const person = {
              firstName: first.firstName,
              name: last.name,
              sirhMatricule: first.sirhMatricule,
              gender: last.gender,
              nationalities: [last.nationality]
            };

            if (first.birthName && first.birthName !== first.name)
              person.birthName = first.birthName;

            // Computing positions
            const slices = partitionBy(years, y => `${y.startDate}§${y.endDate || ''}`),
                  positions = [];

            slices.forEach((slice, sliceIndex) => {
              const nextSlice = slices[sliceIndex + 1],
                    contract = slice[0],
                    nextContract = (nextSlice || [])[0] || {};

              const position = {
                organization: 'FNSP',
                jobName: contract.jobName,
                jobType: contract.jobType,
                timepart: contract.timepart
              };

              // Dates
              if (nextContract.startDate && contract.endDate) {
                if (nextContract.startDate.isBefore(contract.endDate))
                  contract.endDate = nextContract.startDate.subtract(1, 'days');
              }

              if (contract.startDate)
                position.startDate = contract.startDate.format('YYYY-MM-DD');
              if (contract.endDate)
                position.endDate = contract.endDate.format('YYYY-MM-DD');

              // Grades
              position.grades = _(slice)
                .groupBy('gradeSirh')
                .values()
                .map(grades => grades[0])
                .map((grade, i, grades) => {
                  const nextGrade = grades[i + 1];

                  const info = {
                    grade: grade.gradeSirh
                  };

                  if (grade.startDate) {
                    if (!i)
                      info.startDate = grade.startDate.format('YYYY');
                    else
                      info.startDate = grade.year;
                  }

                  if (grades.length === 1) {
                    if (grade.endDate)
                      info.endDate = grade.endDate.format('YYYY');
                  }
                  else {
                    if (nextGrade)
                      info.endDate = nextGrade.year;
                  }

                  return info;
                })
                .value();

              positions.push(position);
            });

            person.positions = positions;

            // Computing academic memberships
            person.academicMemberships = _(years)
              .groupBy('academicMembership')
              .values()
              .map(memberships => _.last(memberships))
              .map((membership, i, memberships) => {
                const nextMembership = memberships[i + 1];

                const info = {
                  organization: membership.academicMembership
                };

                if (membership.startDate) {
                    if (!i)
                      info.startDate = membership.startDate.format('YYYY');
                    else
                      info.startDate = membership.year;
                  }

                  if (memberships.length === 1) {
                    if (membership.endDate)
                      info.endDate = membership.endDate.format('YYYY');
                  }
                  else {
                    if (nextMembership)
                      info.endDate = nextMembership.year;
                  }

                return info;
              })
              .filter(membership => {
                return !!membership.organization;
              })
              .value();

            return person;
          });

          return objects;
        },
        indexer(indexes, person) {
          indexes.id[person._id] = person;
        }
      },

      /**
       * DS_admtech.csv
       */
      {
        name: 'DS_admtech',
        path: 'DS_admtech.csv',
        delimiter: ',',
        skip: true,
        consumer(line) {
          const info = {
            year: line.Année,
            name: line.Nom,
            firstName: line.Prénom,
            gender: line.Genre,
            jobName: line.Fonction,
            academicMembership: line.Unité,
            gradeAdmin: line['Grade académique'],
            organization: line.Tutelle,
            birthDate: line['Année naissance'],
            startDate: line['Entré(e) en']
          };

          if (line.Mail)
            info.contacts = {
              email: line.Mail
            };

          return info;
        },
        resolver(lines) {

          // group by nom,prénom,birthdate
          // tester doublons cross tutelle

          return [];
        },
        indexer() {

          // Si tutelle FNSP -> match SIRH (ajouter grade académique)
          // Si autre tutelle -> match SIRH (grade academique + positions non-FNSP)
          // nom-prenom-birthdate (lowercase -> strip tiret -> deburr)
          // else insert
        }
      }
    ]
  }
};
