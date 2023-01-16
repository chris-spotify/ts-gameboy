import { uint8 } from "./uint8.js";
import { uint16 } from "./uint16.js";

export class Register {
    private _value: uint8;

    constructor(val: uint8){
        this._value = val;
    }

    get value(): uint8{
        return this._value;
    }

    set value(val: uint8){
        this._value = val;
    }
}

export class CombinedRegister {
    firstRegister: Register;
    secondRegister: Register;

    constructor(_first: Register, _second: Register){
        this.firstRegister = _first;
        this.secondRegister = _second;
    }

    get value(){
        return new uint16(this.firstRegister.value.value + (this.secondRegister.value.value << 8));
    }

    set value(val: uint16){
        this.firstRegister.value.value = val.value & 0xFF;
        this.secondRegister.value.value = val.value >> 8; 
    }
}