import { Component, Input, Output, OnInit, OnChanges, SimpleChanges, HostListener, ElementRef, EventEmitter } from '@angular/core';
import { TranslateService, LangChangeEvent } from 'ng2-translate';


@Component({
  selector: 'isari-cols-selector',
  templateUrl: './isari-cols-selector.component.html',
  styleUrls: ['./isari-cols-selector.component.css']
})
export class IsariColsSelectorComponent implements OnInit, OnChanges {
  lang: string;
  open = false;

  @Input() cols: any[] = [];
  @Input() selectedColumns: any[] = [];
  @Output() onColSeleted = new EventEmitter<any>();

  constructor(private elementRef: ElementRef, private translate: TranslateService) { }

  ngOnInit() {
    this.lang = this.translate.currentLang;
    this.translate.onLangChange.subscribe((event: LangChangeEvent) => {
      this.lang = event.lang;
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (this.cols && this.cols.length && this.selectedColumns && this.selectedColumns.length) {
      this.cols = this.cols.map(col => Object.assign(col, {
        selected: !!this.selectedColumns.find(selectedCol => selectedCol.key === col.key)
      }));
    }
  }

  @HostListener('document:click', ['$event', '$event.target'])
  public onClick($event: MouseEvent, targetElement: HTMLElement): void {
      if (!targetElement) {
          return;
      }

      const clickedInside = this.elementRef.nativeElement.contains(targetElement);
      if (!clickedInside) {
          this.closeMenu($event);
      }
  }


  toggleMenu($event) {
    this.open = !this.open;
  }

  closeMenu($event) {
    this.open = false;
  }

  useColumns($event) {
    this.onColSeleted.emit({ cols: this.cols.filter(col => col.selected) });
    this.closeMenu($event);
  }
}
