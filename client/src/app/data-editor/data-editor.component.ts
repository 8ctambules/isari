import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { FormGroup, FormBuilder, FormControl } from '@angular/forms';

@Component({
  selector: 'isari-data-editor',
  templateUrl: 'data-editor.component.html',
  styleUrls: ['data-editor.component.css']
})
export class DataEditorComponent implements OnInit, OnChanges {
  form: FormGroup;

  @Input() fields: Array<any>;

  constructor(public fb: FormBuilder) {}

  ngOnInit() {
    this.form = this.fb.group({});

    // save every 1s on change
    this.form.valueChanges
      .debounceTime(1000)
      .subscribe((value: string) => {
        this.save();
      });
  }

  ngOnChanges (changes: SimpleChanges) {
    if (changes['fields'].currentValue && changes['fields'].currentValue.length) {
      this.fields.forEach(field => {
        this.form.addControl(field.name, new FormControl()); // @TODO : add vaue + validators
      });
    }
  }

  save () {
    if (this.form.valid) {
      console.log('save', this.form.value);
    }
  }

}