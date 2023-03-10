export class uint16 {
    private _value: number;

    constructor(val: number){
        this._value = val & 0xFFFF;
    }

    get value(): number {
        return this._value;
    }

    set value(val: number) {
        this._value = val & 0xFFFF; // ignores over/underflow
    }

    inc(val: number = 1){
        this._value += val;
        this._value &= 0xFFFF;
    }
    
    dec(val: number = 1){
        this._value -= val;
        this._value &= 0xFFFF;
    }
}