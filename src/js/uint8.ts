export class uint8 {
    private _value: number;

    constructor(val: number){
        this._value = val & 0xFF;;
    }

    get value(): number {
        return this._value;
    }

    set value(val: number) {
        this._value = val & 0xFF; // ignores over/underflow
    }

    inc(val: number = 1){
        this._value += val;
        this._value &= 0xFF;
    }

    dec(val: number = 1){
        this._value -= val;
        this._value &= 0xFF;
    }
}