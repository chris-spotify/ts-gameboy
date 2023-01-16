export class uint16 {
    private _value: number;

    constructor(val: number){
        this._value = val;
    }

    get value(): number {
        return this._value;
    }

    set value(val: number) {
        this._value = val & 0xFFFF; // ignores over/underflow
    }
}