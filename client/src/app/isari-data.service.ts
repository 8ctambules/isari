import { Injectable } from '@angular/core';
import { Http, URLSearchParams, RequestOptions } from '@angular/http';
import { FormGroup, FormControl, FormArray, FormBuilder, Validators, ValidatorFn, AbstractControl } from '@angular/forms';
import { environment } from '../environments/environment';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/toPromise';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/operator/combineLatest';
import 'rxjs/add/operator/startWith';
import 'rxjs/add/operator/distinctUntilChanged';
import 'rxjs/add/operator/switchMap';
import 'rxjs/add/operator/publishReplay';
import 'rxjs/add/observable/fromPromise';
import deburr from 'lodash/deburr';
import { UserService } from './user.service';
import { get, sortByDistance } from './utils';
import _get from 'lodash/get';
import keyBy from 'lodash/keyBy';
import omit from 'lodash/omit';
import uniq from 'lodash/uniq';

const mongoSchema2Api = {
  'Organization': 'organizations',
  'People': 'people',
  'Activities': 'activities',
  'Activity': 'activities'
};

const singular = {
  'organizations': 'organization',
  'people': 'people',
  'activities': 'activity'
};

@Injectable()
export class IsariDataService {

  private enumsCache = {};
  private layoutsCache = {};
  private schemasCache = {};
  private columnsCache = null;

  private dataUrl = `${environment.API_BASE_URL}`;
  private layoutUrl = `${environment.API_BASE_URL}/layouts`;
  private enumUrl = `${environment.API_BASE_URL}/enums`;
  private schemaUrl = `${environment.API_BASE_URL}/schemas`;
  private columnsUrl = `${environment.API_BASE_URL}/columns`;
  private exportUrl = `${environment.API_BASE_URL}/export`;
  private editLogUrl = `${environment.API_BASE_URL}/editLog`;

  constructor(private http: Http, private fb: FormBuilder, private userService: UserService) {}

  getHttpOptions (search: {} = null) {
    const options = new RequestOptions({ withCredentials: true });
    options.search = new URLSearchParams();
    options.search.set('organization', this.userService.getCurrentOrganizationId());
    if (search) {
      Object.keys(search).forEach(key => {
        if (search[key]) {
          options.search.set(key, search[key]);
        }
      });
    }
    return options;
  }

  getData(feature: string, id?: string) {
    if (!id) {
      return this.getEmptyDataWith({
        controlType: 'object',
        label: null,
        layout: [],
        multiple: false,
        name: '',
        type: 'object'
      }, feature);
    }
    const url = `${this.dataUrl}/${feature}/${id}`;
    return this.http.get(url, this.getHttpOptions())
      .toPromise()
      .then(response => response.json())
      .catch(this.handleError);
  }

  getDatas(feature: string,
    { fields, applyTemplates, externals, start, end, type }: { fields: string[], applyTemplates: boolean, externals: boolean, start: string, end: string, type: string }) {
    const url = `${this.dataUrl}/${feature}`;
    fields.push('id'); // force id

    let options = this.getHttpOptions({
      fields: fields.join(','),
      applyTemplates: (applyTemplates ? 1 : 0).toString(),
      include: externals ?
        'externals' :
        (start || end ? 'range' : 'members'),
      start: start || null,
      end: end || null,
      type: type || null
    });

    return this.http.get(url, options)
      .toPromise()
      .then(response => response.json())
      .catch(this.handleError);
  }

  getHistory (feature: string, query: any, lang) {

    function getLabel(schema, path, lang) {
      const item = _get(schema, path);
      return item && item.label ? item.label[lang] : '';
    }

    return Observable.combineLatest([
      this.http.get(`${this.editLogUrl}/${feature}`, this.getHttpOptions(query))
        .map((response) => response.json()),
      Observable.fromPromise(this.getSchema(feature)),
      this.getEnum('isariRoles')
        .map(roles => keyBy(roles, 'value')),
    ])

    .map(([logs, schema, roles]) => {
      logs = (<any[]>logs).map(log => {
        log.diff = log.diff.map(diff => Object.assign(diff, {
          // if path = [grades, grade] we get _get(schema, 'grades') then _get(schema, 'grades.grade') and we store the labels
          _label: diff.path.reduce((a, v, i, s) => [...a, getLabel(schema, [...s.slice(0, i), v].join('.'), lang)], [])
        }))
        // all diffs labels
        log._labels = uniq(log.diff.map(diff => (diff._label || []).join(' : ')));
        log.who.roles = log.who.roles.map(role => Object.assign(role, {
          _label: roles[role.role].label[lang],
        }));
        return log;
      });
      return logs;
    });
  }

  getRelations(feature: string, id: string) {
    if (!id) return Promise.resolve({}); // no id === creation === no relations
    const url = `${this.dataUrl}/${feature}/${id}/relations`;
    return this.http.get(url, this.getHttpOptions())
      .toPromise()
      .then(response => response.json())
      .catch(this.handleError);
  }

  removeData(feature: string, id: string) {
    const url = `${this.dataUrl}/${feature}/${id}`;
    return this.http.delete(url, this.getHttpOptions())
      .toPromise()
      .then(response => response.json())
      .catch(this.handleError);
  }

  getLayout(feature: string) {
    // check for cached results
    if (this.layoutsCache[feature]) {
      return this.layoutsCache[feature].toPromise();
    }

    const url = `${this.layoutUrl}/${singular[feature]}`;
    let $layout = this.http.get(url, this.getHttpOptions())
      .map(response => response.json());
    this.layoutsCache[feature] = $layout.publishReplay(1).refCount();
    return $layout.toPromise();
  }

  getColumnsInfo(feature: string) {
    if (this.columnsCache) {
      return Observable.of(this.columnsCache[feature]).toPromise();
    }
    return this.http.get(this.columnsUrl)
      .toPromise()
      .then(response => response.json())
      .then(columns => {
        this.columnsCache = columns;
        return columns[feature];
      })
      .catch(this.handleError);
  }

  getColumnsWithDefault(feature: string) {
    return Promise.all([
      this.getColumns(feature),
      this.getDefaultColumns(feature)
    ]).then(([cols, default_cols]) => default_cols.map(default_col => cols.find(col => col.key === default_col)));
  }

  getDefaultColumns(feature: string) {
    return this.getColumnsInfo(feature).then(info => info['defaults']);
  }

  getSchema(feature: string, path?: string) {
    if (!this.schemasCache[feature]) {
      const url = `${this.schemaUrl}/${singular[feature]}`;
      this.schemasCache[feature] = this.http.get(url, this.getHttpOptions())
        .distinctUntilChanged()
        .toPromise()
        .then(response => response.json())
        .then(schema => {
          // Server always adds 'type = object' on root description, we don't want to bother with that here
          delete schema.type;
          return schema;
        });
    }
    if (path) {
      // We remove every ".0", ".1", etc… in path, as they refer to multiple fields
      // Note: we may add some checks here, worst case = return null, which is an expected possibility
      return this.schemasCache[feature].then(get(path.replace(/\.\d+(?:\.|$)/, '')));
    } else {
      return this.schemasCache[feature];
    }
  }

  getColumns(feature: string) {
    return Promise.all([
      this.getSchema(feature),
      this.getColumnsInfo(feature)
    ]).then(([schema, info]) => {
      const removedColumns = info['selector']
        .filter(col => typeof col === 'string' && col[0] === '-')
        .map(col => col.substring(1));
      const reals = Object.keys(schema)
        .filter(key => removedColumns.indexOf(key) === -1)
        .map(key => ({ key, label: schema[key].label }));
      const virtuals = info['selector']
        .filter(col => typeof col === 'object' && col.key && col.label);
      return reals.concat(virtuals);
    });
  }

  createExportDownloadLink(type, name, query) {
    const options = new URLSearchParams();

    for (const k in query) {
      options.set(k, query[k]);
    }

    const url = `${this.exportUrl}/${type}/${name}?${options}`;

    return url;
  }

  filterEnumValues (enumValues, term, lang) {
    return term
      ? sortByDistance(term, enumValues, e => e.label[lang] || e.label['fr']) // TODO make default lang configurable?
      : enumValues;
  }

  srcEnumBuilder(src: string, materializedPath: string, lang: string) {
    const enum$ = this.getEnum(src);
    return function(terms$: Observable<string>, max, form: FormGroup) {

      const nestedField = this.getFieldForPath(src, form, materializedPath);

      let x$ = terms$
        .startWith('')
        .distinctUntilChanged()
        .combineLatest(enum$)
        .map(([term, enumValues]) => {
          enumValues = this.nestedEnum(src, enumValues, form, materializedPath);

         // term = this.normalize(term.toLowerCase());
         return ({
            reset: false,
            values: this.filterEnumValues(enumValues, term, lang), //.slice(0, max),
            // size: values.length
          });
        });

      // observe source of nested
      if (nestedField) {
        x$ = x$.merge(nestedField.valueChanges.map(x => ({
          reset: true,
          values: []
        })));
      }

      return x$;

    }.bind(this);
  }

  getEnumLabel(src: string, materializedPath: string, form: FormGroup, values: string | string[]) {
    if (!(values instanceof Array)) {
      values = [values];
    }
    return this.getEnum(src)
      .map(enumValues => {
        enumValues = this.nestedEnum(src, enumValues, form, materializedPath);

        return (<string[]>values).map(v => {
          return enumValues.find(entry => entry.value === v);
        }).filter(v => !!v);
      });
  }

  srcForeignBuilder(src: string, path?: string, feature?: string) {
    return (terms$: Observable<string>, max) =>
      terms$
      .startWith('')
      .debounceTime(400) // pass as parameter ?
      .distinctUntilChanged()
      .switchMap(term => this.rawSearch(src, term, path, feature));
  }

  // @TODO handle multiple values (array of ids)
  getForeignLabel(feature: string, values: string | string[]) {
    if (!(values instanceof Array)) {
      values = [values];
    }
    values = values.filter(v => !!v);
    if (values.length === 0) {
      return Observable.of([]);
    }

    const url = `${this.dataUrl}/${mongoSchema2Api[feature] || feature}/${values.join(',')}/string`;
    return this.http.get(url, this.getHttpOptions())
      .map(response => response.json());
      // .map(item => item.value);
  }

  getForeignCreate(feature) {
    return function (name: string) {
      const url = `${this.dataUrl}/${mongoSchema2Api[feature]}`;
      return this.http.post(url, { name }, this.getHttpOptions())
        .map(response => response.json());
    }.bind(this);
  }

  rawSearch(feature: string, query: string, path?: string, rootFeature?: string) {
    const url = `${this.dataUrl}/${mongoSchema2Api[feature] || feature}/search`;
    // return this.http.get(url, this.getHttpOptions({ q: deburr(query) || '*', path, rootFeature }))
    return this.http.get(url, this.getHttpOptions({ q: query || '*', path, rootFeature }))
      .map(response => response.json())
      .map(items => ({
        reset: false,
        values: items.map(item => ({ id: item.value, value: item.label }))
      }));
  }

  buildForm(layout, data): FormGroup {
    let form = this.fb.group({});
    let fields = layout.reduce((acc, cv) => [...acc, ...cv.fields], []);

    // build form from object after layout manipluation
    if (fields[0] instanceof Array) {
      fields = fields.map(f => ({ fields: f}));
    }

    // normalize [[a, b ], c] -> [a, b, c]
    fields = fields.reduce((acc, c) => [...acc, ...(c.fields ? c.fields : [c]) ], []);

    fields.forEach(field => {
      const hasData = data[field.name] !== null && data[field.name] !== undefined;
      const fieldData = hasData ? data[field.name] : field.multiple ? [] : field.type === 'object' ? {} : '';
      if (field.multiple && field.type === 'object') {
        let fa = new FormArray([]);
        // add '.x' for multiple fields (for matching fieldName.*)
        if (this.disabled(data.opts, field.name + '.x')) {
          fa.disable(true);
        }
        fieldData.forEach((d, i) => {
          let subdata = Object.assign({}, d || {}, {
            opts: Object.assign({}, data.opts, {
              path:  [...data.opts.path, field.name, i]
            })
          });
          this.addFormControlToArray(fa, field, subdata);
        });
        form.addControl(field.name, fa);
      } else if (field.type === 'object') {
        let subdata = Object.assign({}, fieldData, {
          opts: Object.assign({}, data.opts, {
            path: [...data.opts.path, field.name]
          })
        });
        form.addControl(field.name, this.buildForm(field.layout, subdata));
      } else {
        form.addControl(field.name, new FormControl({
          value: fieldData,
           // add '.x' for multiple fields (for matching fieldName.*)
          disabled: this.disabled(data.opts, field.name + (field.multiple ? '.x' : ''))
        }, this.getValidators(field)));
      }
    });
    return form;
  }

  private disabled(opts, fieldName) {
    // 1. test globale (editable)
    if (!opts.editable) {
      return true;
    }

    // 2. test restrictedFields
    const path = [...opts.path, fieldName].join('.');
    const regexps = opts.restrictedFields.map(pattern => new RegExp(pattern.replace('.', '\\.').replace('*', '.*')));
    return regexps.reduce((acc, r) => {
      return acc || r.test(path);
    }, false);
  }

  addFormControlToArray(fa: FormArray, field, data) {
    fa.push(this.buildForm(field.layout, data));
  }

  getEmptyDataWith(field: any, feature: string, path: string | undefined = undefined) {
    return this.getSchema(feature, path).then(schema => {
      return this.userService.getRestrictedFields()
        .map(restrictedFields => {
          let fieldClone = Object.assign({}, field || {});
          delete fieldClone.multiple;
          const data = this.buildData(fieldClone, schema);
          data.opts = {
            editable: true,
            restrictedFields: restrictedFields[feature],
            path: path ? path.split('.') : ''
          };
          return data;
        })
        .toPromise();
      });
  }

  // recursively construct empty data following types
  private buildData(field, schema: Object | undefined) {
    if (field.type === 'object') {
      let data = field.layout
        .reduce((acc, row) => [...acc, ...row.fields], [])
        .reduce((acc, f) => Object.assign(acc, {
          [f.name]: this.buildData(f, schema && schema[f.name])
        }), {});
      if (field.multiple) {
        return [data];
      } else {
        return data;
      }
    } else {
     if (field.multiple) {
       return [];
     } else {
       const def = schema && schema['default'];
       return def === undefined ? null : def;
     }
    }
  }

  closeAll(layout) {
    return layout.map(group => {
      if (group.collapsabled) {
        group.collapsed = true; // by default all collapsable groups are closed
      }
      return group;
    });
  }

  translate(layout, lang) {
    return layout.map(group => {
      let grp = Object.assign({}, group, {
        label: group.label ? group.label[lang] : '',
        description: group.description ? group.description[lang] : ''
      });
      if (grp.fields) {
        grp.fields = this.translate(grp.fields, lang);
      }
      if (grp.layout) {
        grp.layout = this.translate(grp.layout, lang);
      }
      return grp;
    });
  }

  getControlType(field): string {
    if (field.enum || field.softenum || field.ref) {
      return 'select';
    }
    if (field.type) {
      return field.type;
    }
    return  'input';
  }


  save(feature: string, data: any) {
    let options = this.getHttpOptions();
    let query: Observable<any>;
    if (data.id) {
      const url = `${this.dataUrl}/${feature}/${data.id}`;
      query = this.http.put(url, data, options);
    } else {
      const url = `${this.dataUrl}/${feature}`;
      query = this.http.post(url, data, options);
    }
    return query.toPromise()
      .then(response => response.json())
      .catch(this.handleError);
  }

  getSchemaApi(feature) {
    return mongoSchema2Api[feature];
  }

  rows(layout) {
    let total = 0;
    return layout
      .map(group => {
        group.fields = group.fields.map(field => {
          total += field.fields ? field.fields.length : 1;
          return (field.fields || [field]).map(f => {
            if (f.type === 'object') {
              f.layout = this.rows(f.layout);
            }
            return f;
          });
        });
        return group;
      })
      .map(group => {
        group.fields = group.fields.map(field => {
          field.colspan = total / field.length;
          return field;
        });
        return group;
      });
  }

  clearCache () {
    this.enumsCache = {};
    this.layoutsCache = {};
    this.schemasCache = {};
    this.columnsCache = null;
  }

  private handleError (error: any): Promise<any> {
    console.error('An error occurred', error); // for demo purposes only
    return Promise.reject(error.message || error);
  }

  private getValidators (field): ValidatorFn|ValidatorFn[]|null {
    if (field && field.requirement && field.requirement === 'mandatory') {
      return [Validators.required];
    }
    return null;
  }

  private normalize(str: string): string {
    return str.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');
  }

  private normalizePath(path) {
    let BLANK = '';
    let SLASH = '/';
    let DOT = '.';
    let DOTS = DOT.concat(DOT);
    let SCHEME = '://';

    if (!path || path === SLASH) {
      return SLASH;
    }

    let prependSlash = (path.charAt(0) === SLASH || path.charAt(0) === DOT);
    let target = [];
    let src, scheme, parts, token;

    if (path.indexOf(SCHEME) > 0) {
      parts = path.split(SCHEME);
      scheme = parts[0];
      src = parts[1].split(SLASH);
    } else {
      src = path.split(SLASH);
    }

    for (let i = 0; i < src.length; ++i) {
      token = src[i];
      if (token === DOTS) {
        target.pop();
      } else if (token !== BLANK && token !== DOT) {
        target.push(token);
      }
    }

    let result = target.join(SLASH).replace(/[\/]{2,}/g, SLASH);

    return (scheme ? scheme + SCHEME : '') + (prependSlash ? SLASH : BLANK) + result;
  }

  getEnum(src: string) {

    // nested
    const nestedPos = src.indexOf(':');
    if (nestedPos !== -1) {
      src = `nested/${src.substr(0, nestedPos)}`;
    }

    // check for cached results
    if (this.enumsCache[src]) {
      return this.enumsCache[src];
    }

    const url = `${this.enumUrl}/${src}`;
    let $enum = this.http.get(url)
      .map(response => {
        let json = response.json();

        // NOTE: this is a dirty special case for nationalities.
        // Might be generic one day...
        if (src === 'nationalities') {
          json = json.filter(item => {
            return !!item.label.fr;
          });
        }

        return json;
      })
      .publishReplay(1)
      .refCount();
    this.enumsCache[src] = $enum;
    return $enum;
  }

  private nestedEnum(src, enumValues, form, materializedPath) {
    const path = this.computePath(src, materializedPath);
    if (!path) {
      return enumValues;
    }
    const key = path.reduce((acc, cv) => acc[cv], form.root.value);
    return key ? enumValues[key] : [];
  }

  private getFieldForPath(src, form, materializedPath) {
    const path = this.computePath(src, materializedPath);
    if (!path) {
      return false;
    }

    return path.reduce((acc, cv) => {
      return acc.get(cv);
    }, form.root);
  }

  private computePath(src, materializedPath): null | string[] {
    const posNested = src.indexOf(':');

    // not nested enum
    if (posNested === -1) {
      return null;
    }

    return this
      .normalizePath(`${materializedPath.replace(/\./g, '/')}/${src.substr(posNested + 1)}`)
      .split('/');
  }

}
