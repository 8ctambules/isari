/**
 * ISARI Import Scripts Activities File Definitions
 * =================================================
 */
const fingerprint = require('talisman/keyers/fingerprint'),
      chalk = require('chalk'),
      moment = require('moment'),
      helpers = require('../helpers'),
      partitionBy = helpers.partitionBy,
      hashPeople = helpers.hashPeople,
      _ = require('lodash');

function fragmentalDate(year, month, day) {
  const date = [year];

  if (month)
    date.push(('0' + month).slice(-2));
  if (day)
    date.push(('0' + day).slice(-2));

  return date.join('-');
}

module.exports = {
  files: [

    /**
     * invites.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'invites',
      path: 'activities/invites.csv',
      delimiter: ',',
      consumer(line) {
        const info = {
          source: line.Source,
          organizations: line['Orga qui accueille']
            .split(',')
            .map(org => org.trim()),
          name: line['Nom Invité'],
          firstName: line['Prénom Invité'],
          nationality: line['Nationalité Invité'],
          gradeAcademic: line.Statut,
          subject: line['Sujet de recherche'],
          course: line.Cours,
          discipline: line.Discipline,
          origin: line['Etablissement d\'origine'],
          originParent: line['Orga d\'origine PARENT'],
          originCountry: line.Pays,
          originCity: line.Ville,
          type: line['Type de séjour'],
          financing: line['Type de financement '],
          startDate: line['Date début'],
          endDate: line['Date fin'],
          inviting: line['Invitant/Contact']
        };

        if (line['email adress'])
          info.contacts = {
            email: line['email adress']
          };

        return info;
      },
      resolver(lines) {

        // 1) Generating people
        const people = {};

        partitionBy(lines, hashPeople)
          .forEach(personLines => {
            const firstLine = personLines[0];

            const peopleInfo = {
              name: firstLine.name,
              firstName: firstLine.firstName
            };

            // Contact
            const contactLine = personLines.find(line => !!line.contacts);

            if (contactLine)
              peopleInfo.contacts = contactLine.contacts;

            // Nationality
            const nationalityLine = personLines.find(line => !!line.nationality);

            if (nationalityLine)
              peopleInfo.nationalities = [nationalityLine.nationality];

            // Grade
            const gradeLine = personLines.find(line => !!line.gradeAcademic);

            if (gradeLine) {
              peopleInfo.gradesAcademic = [{grade: gradeLine.gradeAcademic}];

              peopleInfo.academicMemberships = [{
                organization: gradeLine.origin,
                membershipType: 'membre'
              }];
            }

            // Discipline
            const disciplineLine = personLines.find(line => !!line.discipline);

            if (disciplineLine)
              peopleInfo.tags = {
                free: [disciplineLine.discipline]
              };

            people[hashPeople(firstLine)] = peopleInfo;
          });

        // 2) Generating organizations
        const organizations = {};

        partitionBy(lines.filter(line => !!line.origin), 'origin')
          .forEach(organizationLines => {
            const org = organizationLines[0].origin;

            const orgInfo = {
              name: org
            };

            // Parent
            const parentLine = organizationLines.find(line => !!line.originParent);

            if (parentLine) {
              orgInfo.parentOrganizations = [
                parentLine.originParent
              ];

              // Adding the parent organization just in case
              if (!organizations[parentLine.originParent])
                organizations[parentLine.originParent] = {
                  name: parentLine.originParent
                };
            }

            // Country
            const countryLine = organizationLines.find(line => !!line.originCountry);

            if (countryLine)
              orgInfo.countries = [countryLine.originCountry];

            // Address
            const cityLine = organizationLines.find(line => !!line.originCity);

            if (cityLine)
              orgInfo.address = cityLine.originCountry;

            organizations[org] = orgInfo;
          });

        // 3) Generating activities
        // NOTE: don't forget phantom organization if !origin && country
        // (address would be the city if we have it)
        const activities = lines.map(line => {

          // People
          const personKey = hashPeople(line),
                person = people[personKey];

          const activityInfo = {
            activityType: 'mob_entrante',
            name: `Invité : ${person.firstName} ${person.name}`,
            organizations: [],
            people: [{
              people: personKey
            }]
          };

          // TODO: add a role

          if (line.startDate)
            activityInfo.people[0].startDate = line.startDate;
          if (line.endDate)
            activityInfo.people[0].endDate = line.endDate;

          // Target organization
          if (line.organizations) {
            line.organizations.forEach(org => {
              const linkInfo = {
                organization: org,
                role: 'orgadaccueil'
              };

              if (line.startDate)
                linkInfo.startDate = line.startDate;
              if (line.endDate)
                linkInfo.endDate = line.endDate;

              activityInfo.organizations.push(linkInfo);
            });
          }

          // Origin organization
          if (line.origin) {
            const linkInfo = {
              organization: line.origin,
              role: 'orgadorigine'
            };

            if (line.startDate)
              linkInfo.startDate = line.startDate;
            if (line.endDate)
              linkInfo.endDate = line.endDate;

            activityInfo.organizations.push(linkInfo);
          }

          // Phantom organization
          if (!line.origin && !!line.originCountry) {
            const name = `Invité - Organisation inconnue (${line.originCountry})`;

            const org = {name};
            organizations[name] = org;

            const linkInfo = {
              organization: name,
              role: 'orgadorigine',
              organizationTypes: ['inconnue']
            };

            if (line.startDate)
              linkInfo.startDate = line.startDate;
            if (line.endDate)
              linkInfo.endDate = line.endDate;

            activityInfo.organizations.push(linkInfo);
          }

          // Subject
          const subject = [];

          if (line.subject)
            subject.push(`Sujet de recherche : ${line.subject}`);
          if (line.course)
            subject.push(`Cours : ${line.course}`);
          if (line.type)
            subject.push(`Type de séjour : ${line.type}`);

          if (subject.length)
            activityInfo.subject = subject.join(' ');

          // Summary
          const summary = [];

          if (line.inviting)
            summary.push(`Contact/Invitant : ${line.inviting}`);
          if (line.financing)
            summary.push(`Type de financement : ${line.financing}`);

          if (summary.length)
            activityInfo.summary = summary.join(' ');

          return activityInfo;
        });

        return {
          People: _.values(people),
          Organization: _.values(organizations),
          Activity: activities
        };
      },
      indexers: {
        Organization(indexes, org) {

          // Attempting to match the organization
          let match = indexes.name[org.name];

          if (match)
            return;

          const key = fingerprint(org.name);

          match = indexes.fingerprint[key];

          if (match) {

            this.warning(`Matched "${chalk.green(org.name)}" with "${chalk.green(match.name)}".`);
            return;
          }

          indexes.fingerprint[key] = org;
          indexes.name[org.name] = org;
          indexes.id[org._id] = org;
        },
        People(indexes, person) {
          const key = hashPeople(person);

          const match = indexes.hashed[key];

          if (match) {

            // TODO: merge
            return;
          }

          indexes.id[person._id] = person;
          indexes.hashed[key] = person;
        },
        Activity(indexes, activity) {
          indexes.id[activity._id] = activity;
        }
      }
    },

    /**
     * BANNER_DOCTORANT_HDR.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'BANNER_DOCTORANT_HDR',
      path: 'people/banner/BANNER_DOCTORANT_HDR.csv',
      delimiter: ',',
      peopleFile: true,
      consumer(line) {
        const info = {
          bannerUid: line.ID,
          birthDate: moment(line.DATE_NAISSANCE, 'DD/MM/YYYY').format('YYYY-MM-DD'),
          sirhMatricule: line.MATRICULE_PAIE,
          discipline: line.DISCIPLINE,
          hdr: line.CODE_NIVEAU === '9',
          startDate: line.ANNEE_UNIV_ADMISSION,
          title: line.TITRE_THESE,
          previous: {
            idBanner: line.CODE_ETAB_ADM,
            title: [line.LIB_DIPL_ADM_L1, line.LIB_DIPL_ADM_L2].join(' ').trim(),
            date: line.DATE_DIPL_ADM
          }
        };

        if (line.DATE_SOUTENANCE)
          info.endDate = moment(line.DATE_SOUTENANCE, 'DD/MM/YYYY').format('YYYY-MM-DD');

        const [name, firstName] = line.NOM_COMPLET.split(',');

        info.name = name.trim();
        info.firstName = firstName.trim();

        if (line.EMAIL)
          info.contacts = {
            email: line.EMAIL
          };

        if (line.CODE_NATIONALITE)
          info.nationalities = [line.CODE_NATIONALITE];

        if (line.LIB_SEXE === 'Mr' || line.LIB_SEXE === 'Monsieur')
          info.gender = 'm';
        else
          info.gender = 'f';

        // Retrieving jury members:
        const jury = [];

        for (let i = 1; i < 11; i++) {
          const fullName = line['MEMBRE_JURY_' + i];

          if (!fullName || /NE PAS UTILISER/.test(fullName))
            break;

          const [juryName, juryFirstName] = fullName.split(',');

          const juryMember = {
            name: juryName.trim(),
            firstName: juryFirstName.trim()
          };

          if (line['FONCTION_MEMBRE_JURY_' + i])
            juryMember.quality = line['FONCTION_MEMBRE_JURY_' + i];

          if (line[`MEMBRE_JURY_${i}_PR_IND`] === 'Oui')
            juryMember.president = true;

          if (line[`MEMBRE_JURY_${i}_DT_IND`] === 'Oui')
            juryMember.director = true;

          if (line[`MEMBRE_JURY_${i}_RA_IND`] === 'Oui')
            juryMember.reporter = true;

          jury.push(juryMember);
        }

        info.jury = jury;

        // Retrieving directors
        const directors = [];

        for (let i = 1; i < 3; i++) {
          const fullName = line['DIR_THESE_' + i];

          if (!fullName || /NE PAS UTILISER/.test(fullName))
            break;

          const [directorName, directorFirstName] = fullName.split(',');

          const director = {
            name: directorName.trim(),
            firstName: directorFirstName.trim()
          };

          if (line['TYP_DIR_THESE_' + i] === 'Co-directeur de thèse')
            director.co = true;

          directors.push(director);
        }

        info.directors = directors;

        return info;
      },
      resolver(lines) {
        const people = Object.create(null),
              activities = [];

        // We must group lines per person
        partitionBy(lines, 'bannerUid')
          .forEach(personLines => {
            const phd = personLines.find(person => !person.hdr),
                  hdr = personLines.find(person => person.hdr),
                  ref = phd || hdr;

            if (personLines.length > 2)
              this.warning(`Found ${personLines.length} lines for "${chalk.green(ref.firstName + ' ' + ref.name)}".`);

            const peopleInfo = {
              bannerUid: ref.bannerUid,
              birthDate: ref.birthDate,
              name: ref.name,
              firstName: ref.firstName,
              gender: ref.gender
            };

            if (ref.sirhMatricule) {
              peopleInfo.sirhMatricule = ref.sirhMatricule;
              // add 0 prefix to sirh matricule which were cut by a spreadsheet software
              if (peopleInfo.sirhMatricule.length < 5)
                peopleInfo.sirhMatricule = '0'.repeat(5 - peopleInfo.sirhMatricule.length) + peopleInfo.sirhMatricule;
            }

            if (ref.contacts)
              peopleInfo.contacts = ref.contacts;

            if (ref.nationalities)
              peopleInfo.nationalities = ref.nationalities;

            // Adding people to the local index
            people[hashPeople(peopleInfo)] = peopleInfo;

            // Adding jury & directors to the local index
            ((phd || {}).jury || [])
              .concat((hdr || {}).jury || [])
              .concat((phd || {}).directors || [])
              .concat((hdr || {}).directors || [])
              .forEach(member => {
                const memberInfo = {
                  name: member.name,
                  firstName: member.firstName
                };

                const key = hashPeople(memberInfo);

                if (!people[key])
                  people[key] = memberInfo;
              });

            // Creating activities
            peopleInfo.distinctions = [];

            if (phd) {
              const activity = {
                activityType: 'doctorat',
                name: `Doctorat : ${peopleInfo.firstName} ${peopleInfo.name}`,
                organizations: [
                  {
                    organization: ['IEP Paris'],
                    role: 'inscription'
                  }
                ],
                people: [
                  {
                    people: {
                      sirh: peopleInfo.sirhMatricule,
                      hash: hashPeople(peopleInfo)
                    },
                    role: 'doctorant(role)'
                  }
                ]
              };

              activities.push(activity);

              // Add previous diploma
              if (phd.previous.idBanner) {
                const previousDistinction = {
                  distinctionType: 'diplôme',
                  title: phd.previous.title,
                  organizations: [phd.previous.idBanner]
                };

                if (phd.previous.date)
                  previousDistinction.date = phd.previous.date;

                peopleInfo.distinctions.push(previousDistinction);
              }

              // Add PHD
              const distinction = {
                distinctionType: 'diplôme',
                title: 'Doctorat',
                organizations: ['FNSP'],
                countries: ['FR']
              };

              if (phd.endDate)
                distinction.date = phd.endDate;

              peopleInfo.distinctions.push(distinction);

              // Add gradesAcademic
              const grade = {
                grade: 'doctorant(grade)'
              };

              if (phd.startDate)
                grade.startDate = phd.startDate;
              if (phd.endDate)
                grade.endDate = phd.endDate;

              peopleInfo.gradesAcademic = [grade];
            }

            if (hdr) {
              const activity = {
                activityType: 'hdr',
                name: `HDR : ${peopleInfo.firstName} ${peopleInfo.name}`,
                organizations: [
                  {
                    organization: ['IEP Paris'],
                    role: 'inscription'
                  }
                ],
                people: [
                  {
                    people: {
                      sirh: peopleInfo.sirhMatricule,
                      hash: hashPeople(peopleInfo)
                    },
                    role: 'doctorant(role)'
                  }
                ]
              };

              activities.push(activity);

              const distinction = {
                distinctionType: 'diplôme',
                title: 'HDR',
                organizations: ['FNSP'],
                countries: ['FR']
              };

              if (hdr.endDate)
                distinction.date = hdr.endDate;

              peopleInfo.distinctions.push(distinction);
            }
          });

        // TODO: compute activities from there

        // TODO: Sorting people by gender to avoid cases where someone would be
        // referenced first as jury and then as doctorant.
        return {
          People: _.values(people),
          Activity: activities
        };
      },
      indexers: {
        People(indexes, person) {
          const key = hashPeople(person);

          let match;

          // First, we try to match through SIRH
          if (person.sirhMatricule)
            match = indexes.sirh[person.sirhMatricule];

          // Else we attempt the hash
          if (!match)
            match = indexes.hashed[key];

          if (match) {

            // TODO: merge
            return;
          }

          // Else we index the people
          if (person.sirhMatricule)
            indexes.sirh[person.sirhMatricule] = person;
          indexes.hashed[key] = person;
          indexes.id[person._id] = person;
        },
        Activity(indexes, activity) {
          indexes.id[activity._id] = activity;
        }
      }
    },

    /**
     * sejours_etranger.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'sejours_etranger',
      path: 'activities/sejours_etranger.csv',
      delimiter: ',',
      consumer(line) {
        const info = {
          researchUnit: line.UR,
          organization: line.Organisation,
          name: line.Nom,
          firstName: line.Prénom,
          subject: line['Type de séjour'],
          summary: line.Mission,
          address: line.Lieu,
          country: line.Pays
        };

        if (line['date début'])
          info.startDate = line['date début'].split('T')[0];

        if (line['date fin'])
          info.endDate = line['date fin'].split('T')[0];

        return info;
      },
      resolver(lines) {
        const organizations = {},
              people = {},
              activities = [];

        // TODO: forgot something?
        lines.forEach(line => {

          // Handling the person
          const person = {
            name: line.name,
            firstName: line.firstName
          };

          const key = hashPeople(person);

          if (line.researchUnit)
            person.academicMemberships = [{organization: line.researchUnit}];

          people[key] = person;

          // Handling the organization
          let org;

          if (line.organization) {
            org = {
              name: line.organization
            };

            if (line.country)
              org.countries = [line.country];

            if (line.address)
              org.address = line.address;

            organizations[org.name] = org;
          }

          // Handling the activity
          const activity = {
            name: `Séjour de recherche : ${person.firstName} ${person.name}`,
            activityType: 'mob_sortante',
            people: [
              {people: key}
            ]
          };

          // TODO: phantom
          if (org)
            activity.organizations = [
              {
                organization: org.name,
                role: 'orgadaccueil'
              }
            ];

          [
            'subject',
            'summary',
            'startDate',
            'endDate'
          ].forEach(prop => {
            if (line[prop])
              activity[prop] = line[prop];
          });

          activities.push(activity);
        });

        return {
          Organization: _.values(organizations),
          People: _.values(people),
          Activity: activities
        };
      },
      indexers: {
        Organization(indexes, org) {
          const key = fingerprint(org.name);

          // Let's attempt to match the organization
          let match = indexes.name[org.name];

          if (!match)
            match = indexes.fingerprint[key];

          if (match)
            return;

          // Let's add the organization
          indexes.name[org.name] = org;
          indexes.fingerprint[key] = org;
          indexes.id[org._id] = org;
        },
        People(indexes, person) {
          const key = hashPeople(person);

          // Let's attempt to match the person
          const match = indexes.hashed[key];

          if (match)
            return;

          this.warning(`Could not match ${chalk.green(person.firstName + ' ' + person.name)}.`);

          // Let's add the person
          indexes.hashed[key] = person;
          indexes.id[person._id] = person;
        },
        Activity(indexes, activity) {
          indexes.id[activity._id] = activity;
        }
      }
    },

    /**
     * contrats_isari.csv
     * -------------------------------------------------------------------------
     */
    {
      name: 'contrats_isari',
      path: 'activities/contrats_isari.csv',
      consumer(line) {
        const info = {
          name: line.acronym, // activity.name
          subject: line.name, // activity.subject
          grantIdentifier: line['grants.grantIdentifier'], // grants.grantIdentifier
          organization: line['grants.organization'], // organization.name (need to be matched)
          grantProgram: line['grants.grantProgram'], // grants.grantProgram
          grantType: line['grants.grantType'], // grants.grantType
          grantInstrument: line['grants.grantInstrument'],
          grantCall: line['grants.grantCall'], //grants.grantCall
          organizationPi: line['organisation du PI si pas Sciences Po (rôle coordinateur)'], // to match with orga
          organizationRole: line['Rôle labo'],
          organizationPartner: line['organizations role=partenaire'], // to match with orga
          grantStatus: line.grantstatus, //grants.status
          UG: line.UG, // grants.UG
          overheadsCalculation: line.overheadsCalculation, // grants.overheadsCalculation
          budgetType: line['amounts.budgetType = overheads'], // grants.amounts avec grants.amounts.budgetType="overheads"
        };

        if (line['people.role=PI'])
          info.peoplePi = JSON.parse(line['people.role=PI']);

        // TODO: solve
        if (line['people.role=responsable scientifique only IF different from PI'])
          info.peopleRespoSc = JSON.parse(line['people.role=responsable scientifique only IF different from PI']);

        if (line['people.role=membre'])
          info.peopleMembre = JSON.parse(line['people.role=membre']);

        if (line['amount.amountType = sciencespodemande'])
          info.amountTypeDemande = +line['amount.amountType = sciencespodemande'];

        if (line['amount.amountType = consortiumobtenu'])
          info.amountTypeConsortium = +line['amount.amountType = consortiumobtenu'];

        if (line['amount.amountType = sciencespoobtenu'])
          info.amountTypeObtenu = +line['amount.amountType = sciencespoobtenu'];

        if (line.durationInMonths)
          info.durationInMonths = +line.durationInMonths;

        if (line.delegationCnrs)
          info.delegationCnrs = true;

        if (line['startDate.year']) {
          info.startDate = fragmentalDate(
            line['startDate.year'],
            line['startDate.month'],
            line['startDate.day']
          );
        }

        if (line['endDate.year']) {
          info.endDate = fragmentalDate(
            line['endDate.year'],
            line['endDate.month'],
            line['endDate.day']
          );
        }

        if (line['submissionDate.year']) {
          info.submissionDate = fragmentalDate(
            line['submissionDate.year'],
            line['submissionDate.month'],
            line['submissionDate.day']
          );
        }

        return info;
      },
      resolver(lines) {
        const organizations = {},
              people = {},
              activities = [];

        lines.forEach(line => {
          const grant = {};

          [
            'grantIdentifier',
            'grantProgram',
            'grantType',
            'grantInstrument',
            'grantCall',
            'durationsInMonths',
            'status',
            'UG',
            'overheadsCalculation',
            'delegationCnrs',
            'startDate',
            'endDate',
            'submissionDate'
          ].forEach(prop => {
            if (line.hasOwnProperty(prop))
              grant[prop] = line[prop];
          });

          // Handling organization
          if (line.organization) {
            const key = fingerprint(line.organization);

            grant.organisation = line.organization;

            if (!organizations[key]) {
              organizations[key] = {
                name: line.organization
              };
            }
          }

          const activity = {
            name: line.name,
            activityType: 'projetderecherche',
            grants: [grant]
          };

          if (line.subject)
            activity.subject = line.subject;

          // Pushing the activity
          activities.push(activity);

          // if (line.grantsOrganization) {
          //   activity.organizations.organization = line.grantsOrganization;
          //   organization.name = line.grantsOrganization;
          // }

          // if (line.organizationPartner) {
          //   activity.organizations.organization = line.organizationPartner;
          //   activity.organizations.role = 'partenaire';
          // }

          // if (line.organizationPi) {
          //   activity.organizations.organization = line.organizationPi;
          //   activity.organizations.role = 'coordinateur';
          // }
        });

        return {
          Organization: _.values(organizations),
          People: _.values(people),
          Activity: activities
        };
      },
      indexers: {
        Organization(indexes, org) {
          const key = fingerprint(org.name);

          let match = indexes.name[org.name];

          if (!match)
            match = indexes.acronym[org.name];

          if (!match)
            match = indexes.fingerprint[key];

          if (match)
            return;

          // Adding the new org
          indexes.name[org.name] = org;
          indexes.fingerprint[key] = org;
          indexes.id[org._id] = org;
        },
        Activity(indexes, activity) {
          indexes.id[activity._id] = activity;
        }
      }
    }
  ]
};
