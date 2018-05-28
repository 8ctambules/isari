import { Component, Input, Output, OnInit, EventEmitter, ViewChild, ElementRef, SimpleChanges, OnChanges } from '@angular/core';
import { FormGroup, FormControl } from '@angular/forms';
import { ENTER, COMMA } from '@angular/cdk/keycodes';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/observable/combineLatest';
import 'rxjs/add/operator/startWith';
import 'rxjs/add/operator/skip';
import { TranslateService, LangChangeEvent } from 'ng2-translate';
import { MatAutocompleteSelectedEvent, MatChipInputEvent } from '@angular/material';

@Component({
  selector: 'isari-select',
  templateUrl: './isari-select.component.html',
  styleUrls: ['./isari-select.component.css']
})
export class IsariSelectComponent implements OnInit {
  separatorKeysCodes = [ENTER, COMMA];
  max = 20;
  selectControl: FormControl;
  disabled: boolean;
  filteredItems: Observable<any>;
  id: string | undefined;

  @Input() name: string;
  @Input() path: string;
  @Input() form: FormGroup;
  @Input() label: string;
  @Input() requirement: string;
  @Input() description: string;
  @Input() src: Function;
  @Input() api: string;
  @Input() extensible = false;
  @Input() stringValue: Observable<any>;
  @Input() create: Function;
  @Output() onUpdate = new EventEmitter<any>();
  @Input() showLink: boolean = true;

  @ViewChild('selectInput') selectInput: ElementRef;

  constructor(private translate: TranslateService) { }

  add(event: MatChipInputEvent) {
    this.selectInput.nativeElement.value = '';
    this.selectControl.setValue(null);
  }

  displayFn(item) {
    return item ? item.label : undefined;
  }

  selected({ option: { value: item } }: MatAutocompleteSelectedEvent) {
    this.form.controls[this.name].setValue(item.id || item.value);
    this.onUpdate.emit({ log: true, path: this.path, type: 'update' });
  }

  ngOnInit() {
    // this.lang = this.translate.currentLang;
    this.disabled = this.form.controls[this.name].disabled;

    this.selectControl = new FormControl({
      value: '',
      disabled: this.disabled
    });

    this.filteredItems =
      Observable.combineLatest(
        this.src(this.selectControl.valueChanges.skip(1).map(x => trans(x, 'fr')), this.max, this.form),
        this.translate.onLangChange
          .map((event: LangChangeEvent) => event.lang)
          .startWith(this.translate.currentLang),
        this.extensible ? this.selectControl.valueChanges.skip(1) : Observable.of(null)
      ).map(([{ values, reset }, lang, inputValue]: [{ values: any[], reset: boolean | string }, string, any]) => {
        let x = values.map(item => translateItem(item, lang));

        if (reset && reset === this.path && this.selectControl.value) {
          this.form.controls[this.name].setValue(' ');
          this.selectControl.setValue('');
          this.onUpdate.emit({ log: true, path: this.path, type: 'update' });
        }

        if (!inputValue) return x;
        inputValue = { value: inputValue, label: inputValue, new: true };
        if (x[0].new) x[0] = inputValue;
        else x = [inputValue, ...x];
        return x;
      });

    function trans(item, lang = 'fr') {
      return (item && item.label && item.label[lang]) || (item && item.value) || item;
    }

    function translateItem(item, lang = 'fr') {
      const label = (item && item.label && item.label[lang])
        ? item.label[lang]
        : (item && item.label && item.label['fr'])
          ? item.label['fr']
          : (item && item.value) || '';
      return { ...item, label };
    }

    Observable.combineLatest(
      this.stringValue,
      this.translate.onLangChange
        .map((event: LangChangeEvent) => event.lang)
        .startWith(this.translate.currentLang)
    ).subscribe(([stringValues, lang]) => {
      const value = this.form.controls[this.name].value;
      this.id = (stringValues.length > 0) && stringValues[0].id;
      this.selectControl.setValue(translateItem(stringValues.length ? stringValues[0] : { value }, lang));
    });
  }

}
