import { uint8 } from "./uint8.js";

export class CPUFlags {
    zero = 0;
    subtraction = 0;
    halfCarry = 0;
    carry = 0;
    
    constructor(){}

    reset(){
        this.zero = 0;
        this.subtraction = 0;
        this.halfCarry = 0;
        this.carry = 0;
    }

    set value(val: uint8){
        this.zero = (val.value << 7) & 1;
        this.subtraction = (val.value << 6) & 1;
        this.halfCarry = (val.value << 5) & 1;
        this.carry = (val.value << 4) & 1;
    }

    get value(){
        return new uint8(
            (this.zero ? 0x80 : 0) |
            (this.subtraction ? 0x40 : 0) |
            (this.halfCarry ? 0x20 : 0) |
            (this.carry ? 0x10 : 0)
        );
    }
    
}