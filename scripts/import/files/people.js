/**
 * ISARI Import Scripts People File Definitions
 * =============================================
 */
const moment = require('moment'),
      ENUM_INDEXES = require('../indexes').ENUM_INDEXES,
      helpers = require('../helpers'),
      chalk = require('chalk'),
      partitionBy = helpers.partitionBy,
      hashPeople = helpers.hashPeople,
      _ = require('lodash');

module.exports = {
  files: [

    /**
     * SIRH.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'sirh',
      path: 'people/SIRH.csv',
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
          gradeRHLabel: line['Emploi Repère'],
          gradeRH: line['Code_Emploi Repère'],
          postdoc: line.Postdoc === 'x',
          jobName: line['Emploi Personnalisé'],
          academicMembership: line.Affiliation
        };

        // add 0 prefix to sirh matricule which were cut by a spreadsheet software
        if (info.sirhMatricule.length < 5)
          info.sirhMatricule = '0'.repeat(5 - info.sirhMatricule.length) + info.sirhMatricule;

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

        const filteredLines = lines.filter(line => {
          // filtering SIRH cases which doesn't make sense for ISARI
          return !(line.jobType === 'CDI' && line.gradeRHLabel === 'Hors Accord');
        });

        // First we need to group the person by matricule
        let persons = partitionBy(filteredLines, 'sirhMatricule');

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
            nationalities: [last.nationality],
            birthDate: first.birthDate
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
              jobType: contract.jobType,
              timepart: contract.timepart
            };

            // Finding the last job name
            const jobNameLine = slice.slice().reverse().find(line => !!line.jobName);

            if (jobNameLine)
              position.jobName = jobNameLine.jobName;

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
            position.gradesSirh = _(slice)
              .groupBy('gradeRH')
              .values()
              .map(grades => grades[0])
              .map((grade, i, grades) => {
                const nextGrade = grades[i + 1];

                const info = {
                  postdoc: grade.postdoc
                };

                // filling grade with enum quality check
                if (ENUM_INDEXES.grades.sirh[grade.gradeRH])
                  info.grade = grade.gradeRH;
                else {
                  // trying to infer grade from grade label (shitty cases Hors Accord)
                  _(ENUM_INDEXES.grades.sirh).forEach((v, k) => {
                    if (v === grade.gradeRHLabel)
                      info.grade = k;
                  });
                }
                if (!info.grade)
                  // fall back to Hors Accord
                  info.grade = 'HA';

                if (grade.startDate) {
                  if (!i)
                    info.startDate = grade.startDate.format('YYYY-MM-DD');
                  else
                    info.startDate = grade.year;
                }

                if (grades.length === 1) {
                  if (grade.endDate)
                    info.endDate = grade.endDate.format('YYYY-MM-DD');
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

          // let's copy gradeSIRH to grades
          person.grades = _(positions)
            .filter(p => p.gradesSirh)
            .map(p => p.gradesSirh)
            .flatten()
            .map(originalGrade => {
              const postdoc = originalGrade.postdoc;
              delete originalGrade.postdoc;

              const grade = _.clone(originalGrade);
              if (postdoc) {
                grade.gradeStatus = 'chercheur';
                grade.grade = 'postdoc';
              }
              else {
                // use a patch index which translate SIRH grades to grades
                const newGrade = ENUM_INDEXES.grades.sirh2grades[grade.grade];
                if (newGrade) {
                  grade.gradeStatus = newGrade.gradeStatus;
                  grade.grade = newGrade.grade;
                }
                else {
                  grade.gradeStatus = 'appuiadministratif';
                  grade.grade = 'AUT';
                }
              }
              return grade;
            })
            // let's merge contiguous grades
            .groupBy(g => g.gradeStatus + g.grade)
            .values()
            .map(grades => {
              return _.transform(grades, (r, o) => {
                if (r.length && r[r.length - 1].endDate === o.startDate) {
                  // we merge if we have same previous.enDate and next.startDate
                  if (o.endDate)
                    // update previous endDate
                    r[r.length - 1].endDate = o.endDate;
                  else
                    // no endDate so delete previous one
                    delete(r[r.length - 1].endDate);
                }
                else
                  // no merge we add to accumulator
                  r.push(o);
                return true;
              }, []);
            })
            .flatten()
            .value();


          // Computing academic memberships
          person.academicMemberships = _(years)
            .groupBy(y => y.academicMembership + y.startDate)
            .values()
            .map(memberships => _.first(memberships))
            .map((membership, i, memberships) => {
              const nextMembership = memberships[i + 1];

              const info = {
                organization: membership.academicMembership,
                membershipType: 'membre'
              };

              if (membership.startDate)
                    info.startDate = membership.startDate.format('YYYY-MM-DD');

              if (membership.endDate)
                  info.endDate = membership.endDate.format('YYYY-MM-DD');
              else
                if (nextMembership)
                  info.endDate = nextMembership.starDate ? nextMembership.startDate : nextMembership.year;

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
        indexes.hashed[hashPeople(person)] = person;
        indexes.sirh[person.sirhMatricule] = person;
      }
    },

    /**
     * DS_admtech.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'DS_admtech',
      path: 'people/DS_admtech.csv',
      delimiter: ',',
      consumer(line) {
        const info = {
          year: line.Année,
          name: line.Nom,
          firstName: line.Prénom,
          gender: line.Genre,
          jobName: line.Fonction,
          academicMembership: line.Unité,
          organization: line.Tutelle,
          birthDate: line['Année naissance'],
          startDate: line['Entré(e) en']
        };

        if (line.Mail)
          info.contacts = [{
            email: line.Mail
          }];

        // converting typeAppui to gradeStatus
        if (line.type_appui === 'AT')
          info.gradeStatus = 'appuitechnique';
        else
          info.gradeStatus = 'appuiadministratif';

        // use a patch index which translate SIRH grades to grades
        const newGrade = ENUM_INDEXES.grades.sirh2grades[line['Grade académique']];
        if (newGrade) {
          info.grade = newGrade.grade;
        }
        else {
          // fall back to AUT in case of unknown grade
          info.grade = 'AUT';
        }

        return info;
      },
      resolver(lines) {

        let persons = partitionBy(lines, hashPeople);

        // Sort by years
        persons = persons.map(years => {
          return _.sortBy(years, 'year');
        });

        const objects = persons.map(years => {
          const first = years[0],
                job = _.find(years.slice().reverse(), year => !!year.jobName),
                start = years.find(year => !!year.startDate);

          const person = {
            name: first.name,
            firstName: first.firstName,
            gender: first.gender,
            birthDate: first.birthDate
          };

          if (first.contacts)
            person.contacts = first.contacts;

          // So, here, we create a single position using the last job name
          // found, and then we create temporal grades.
          if (job) {
            person.positions = [{
              jobName: job.jobName,
              organization: job.organization
            }];

            if (job.organization === 'CNRS' || job.organization === 'MESR')
              person.positions.jobType = 'emploipublic'

            if (start)
              person.positions[0].startDate = start.startDate;

            // If the year we got is not 2016, this means this person is not in contract anymore
            // The same applies below to grades and memberships
            if (job.year !== '2016')
              person.positions[0].endDate = job.year;
          }

          // Admin grades

          person.grades = partitionBy(years.filter(year => !!year.grade), 'grade')
            .map((slice, i, slices) => {
              const nextSlice = slices[i + 1];

              const info = {
                grade: slice[0].grade,
                gradeStatus: slice[0].gradeStatus
              };

              if (!i && slice[0].startDate)
                info.startDate = slice[0].startDate;
              else
                info.startDate = slice[0].year;

              if (nextSlice && nextSlice[0])
                info.endDate = nextSlice[0].year;
              else if (slice[slice.length - 1].year !== '2016')
                info.endDate = slice[slice.length - 1].year;

              return info;
            })
            .filter(g => !!g);

          person.academicMemberships = partitionBy(years.filter(year => !!year.academicMembership), 'academicMembership')
            .map((slice, i, slices) => {
              const nextSlice = slices[i + 1];

              const info = {
                organization: slice[0].academicMembership,
                membershipType: 'membre'
              };

              if (!i && slice[0].startDate)
                info.startDate = slice[0].startDate;
              else
                info.startDate = slice[0].year;

              if (nextSlice && nextSlice[0])
                info.endDate = nextSlice[0].year;
              else if (slice[slice.length - 1].year !== '2016')
                  info.endDate = slice[slice.length - 1].year;

              return info;
            });

          return person;
        });

        return objects;
      },
      indexer(indexes, person) {

        // Here, we are trying to match someone in the previous SIRH file.
        // If we found one & we have a FNSP position, we add grade & email
        // If we found one & we haveg another position, we push position + grade + email
        // Else, we just insert the person.
        const key = hashPeople(person),
              match = indexes.hashed[key];

        if (match) {

          if (!person.positions)
            return;

          const org = person.positions[0].organization;


          if (org !== 'FNSP')
              match.positions = match.positions.concat(person.positions);

          // if admtech has a grade let's overwrite the default SIRH grade
          if (person.grades)
            match.grades = person.grades;

          // Overriding academic memberships
          if (person.academicMemberships)
            match.academicMemberships = person.academicMemberships;

          // Mail
          if (person.contacts) {
            match.contacts = match.contacts || [];
            match.contacts.push.apply(match.contacts, person.contacts);
          }

          return;
        }

        indexes.hashed[key] = person;
        indexes.id[person._id] = person;
      }
    },

    /**
     * DS_academic.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'DS_academic',
      path: 'people/DS_academic.csv',
      delimiter: ',',
      consumer(line) {
        const info = {
          year: line.Année,
          name: line.Nom,
          firstName: line.Prénom,
          gender: line.GENRE,
          birthDate: line.Âge,
          organization: line.Tutelle,
          grade: line.Grade,
          gradeStatus: line.Statut
        };

        if (line.Mail)
          info.contacts = [{
            email: line.Mail
          }];

        if (line.Nationalité)
          info.nationalities = line.Nationalité.split(',');

        if (line['Entré(e) en'])
          info.startDate = line['Entré(e) en'].slice(0, 4);

        if (line['Prime Incitation / Convergence']) {
          info.bonuses = line['Prime Incitation / Convergence']
            .split(';')
            .map(string => {
              const [startDate, endDate] = string.trim().split('-');

              const bonusType = info.organization === 'FNSP' ?
                'primeConvergence' :
                'primeIncitation';

              return {
                bonusType,
                startDate,
                endDate
              };
            });
        }

        if (line['Paysd\'obtentionduPhD'] || line['Année d\'obtention du PhD']) {
          const countries = line['Paysd\'obtentionduPhD'].split(',');

          info.distinctions = [{
            countries,
            distinctionType: 'diplôme',
            distinctionSubtype: 'doctorat',
            title: 'Doctorat'
          }];

          if (line['Année d\'obtention du PhD'])
            info.distinctions[0].date = line['Année d\'obtention du PhD'];

          if (line.PhdSciencesPo === 'oui')
            info.distinctions[0].organizations = ['IEP Paris'];
        }

        if (line['HDRouéquivalent'] === 'oui') {
          info.distinctions = info.distinctions || [];
          info.distinctions.push({
            distinctionType: 'diplôme',
            distinctionSubtype: 'hdr',
            title: 'HDR'
          });
        }

        if (line.Dpmt) {
          info.deptMemberships = line.Dpmt
            .split(',')
            .map(dept => {
              return {
                departement: dept.trim()
              };
            });
        }

        if (line['Unité de recherche'] &&
            line['Unité de recherche'] !== 'Non affilié')
          info.academicMemberships = line['Unité de recherche']
            .split(',')
            .map(org => ({
              organization: org.trim(),
              membershipType: 'membre'
            }));

        if (line['Autres affiliations']) {
          info.academicMemberships = info.academicMemberships || [];
          info.academicMemberships.push.apply(
            info.academicMemberships,
            line['Autres affiliations']
              .split(',')
              .map(org => ({
                organization: org.trim(),
                membershipType: 'membre'
              }))
          );
        }

        if (line['HCERES 2017']) {
          info.tags = {hceres2017: line['HCERES 2017'].split(';').map(tag => tag.trim())};
        }

        return info;
      },
      resolver(lines) {

        // For unit information, find a line where the information is given
        // Need to chronologically order memberships
        let persons = partitionBy(lines, line => `${line.name}§${line.firstName}`);

        // Sort by years
        persons = persons.map(years => {
          return _.sortBy(years, 'year');
        });

        // Building objects
        const objects = persons.map(years => {
          const firstYear = years[0],
                lastYear = years[years.length - 1];

          const info = {
            name: firstYear.name,
            firstName: firstYear.firstName,
            contacts: lastYear.contacts,
            tags: firstYear.tags
          };

          // Finding gender
          const genderYear = years.find(year => !!year.gender);

          if (genderYear)
            info.gender = genderYear.gender;

          // Finding nationalities
          const nationalitiesYear = years.find(year => !!(year.nationalities || []).length);

          if (nationalitiesYear)
            info.nationalities = nationalitiesYear.nationalities;

          // Finding birthDate
          const birthDateYear = years.find(year => !!year.birthDate);

          if (birthDateYear)
            info.birthDate = birthDateYear.birthDate;

          // Finding distinctions (get the year with most distinctions)
          const distinctionYear = _(years)
            .sortBy(year => -(year.distinctions || []).length)
            .first();

          if (distinctionYear.distinctions)
            info.distinctions = distinctionYear.distinctions;

          // Finding bonuses
          const bonusesYear = years.find(year => !!(year.bonuses || []).length);

          if (bonusesYear)
            info.bonuses = bonusesYear.bonuses;

          // Chronologies: positions, dpt, academic memberships, gradesAcademic
          const positionSlices = partitionBy(years, 'organization');

          // Positions
          info.positions = positionSlices.map((slice, i) => {
            const nextSlice = positionSlices[i + 1];

            const jobInfo = {
              jobType: 'emploipublic',
              organization: slice[0].organization
            };

            if (slice[0].organization === 'FNSP') {
              if (slice[slice.length - 1].grade === 'assistantprofessor')
                jobInfo.jobType = 'CDD';
              else
                jobInfo.jobType = 'CDI';
            }


            // Dates
            if (!i && slice[0].startDate)
              jobInfo.startDate = slice[0].startDate;
            else
              jobInfo.startDate = slice[0].year;

            if (nextSlice)
              jobInfo.endDate = nextSlice[0].year;
            else if (slice[slice.length - 1].year !== '2016')
              jobInfo.endDate = slice[slice.length - 1].year;

            return jobInfo;
          });

          // Departement memberships
          info.deptMemberships = [];
          years
            .filter(year => !!year.deptMemberships)
            .forEach((year, i, relevantYears) => {

              year.deptMemberships.forEach(membership => {
                let relevantMembership = info.deptMemberships.find(m => m.departement === membership.departement);

                // If no relevant membership was found, we add it
                if (!relevantMembership) {
                  relevantMembership = {
                    departement: membership.departement,
                    startDate: !i && year.startDate ? year.startDate : year.year
                  };

                  if (relevantYears[i + 1] || year.year !== '2016')
                    relevantMembership.endDate = year.year;

                  info.deptMemberships.push(relevantMembership);
                }

                // Else we update the endDate if not final year
                else if (relevantYears[i + 1]) {
                  relevantMembership.endDate = year.year;
                }

                else if (!relevantYears[i + 1] && year.year !== '2016') {
                  relevantMembership.endDate = year.year;
                }

                else {
                  delete relevantMembership.endDate;
                }
              });
            });

          if (!info.deptMemberships.length)
            delete info.deptMemberships;

          // Academic memberships
          info.academicMemberships = [];
          years
            .filter(year => !!year.academicMemberships)
            .forEach((year, i, relevantYears) => {

              year.academicMemberships.forEach(membership => {
                let relevantMembership = info.academicMemberships.find(m => m.organization === membership.organization);

                // If no relevant membership was found, we add it
                if (!relevantMembership) {
                  relevantMembership = {
                    organization: membership.organization,
                    startDate: !i && year.startDate ? year.startDate : year.year,
                    membershipType: 'membre'
                  };

                  if (relevantYears[i + 1] || year.year !== '2016')
                    relevantMembership.endDate = year.year;

                  info.academicMemberships.push(relevantMembership);
                }

                // Else we update the endDate if not final year
                else if (relevantYears[i + 1]) {
                  relevantMembership.endDate = year.year;
                }

                else if (!relevantYears[i + 1] && year.year !== '2016') {
                  relevantMembership.endDate = year.year;
                }

                else {
                  delete relevantMembership.endDate;
                }
              });
            });

          if (!info.academicMemberships.length)
            delete info.academicMemberships;


          // Grades academic
          info.grades = [];
          years
            .filter(year => !!year.grade || !!year.gradeStatus)
            .forEach((year, i, relevantYears) => {

              let relevantGrade = info.grades.find(m => m.grade === year.grade);
              // If no relevant grade was found, we add it
              if (!relevantGrade) {

                relevantGrade = {
                  startDate: !i && year.startDate ? year.startDate : year.year,
                };

                if (i !== relevantYears.length - 1)
                  relevantGrade.endDate = year.year;

                relevantGrade.grade = year.grade;
                relevantGrade.gradeStatus = year.gradeStatus;

                info.grades.push(relevantGrade);
              }

              // Else we update the endDate if not final year
              else if (relevantYears[i + 1]) {
                relevantGrade.endDate = year.year;
              }

              else if (!relevantYears[i + 1] && year.year !== '2016') {
                relevantGrade.endDate = year.year;
              }

              else {
                delete relevantGrade.endDate;
              }
            });

          if (!info.grades.length)
            delete info.grades;

          return info;
        });

        return objects;
      },
      indexer(indexes, person) {
        const key = hashPeople(person);

        // We attempt to match by hash
        const match = indexes.hashed[key];

        if (match) {

          // Overrides
          [
            'contacts',
            'nationalities',
            'bonuses',
            'distinctions',
            'deptMemberships',
            'academicMemberships',
            'tags',
            'grades',
          ].forEach(prop => {
            if (person[prop])
              match[prop] = person[prop];
          });

          return;
        }


        // Else we create the person
        indexes.hashed[key] = person;
        indexes.id[person._id] = person;
      }
    }
  ]
};
