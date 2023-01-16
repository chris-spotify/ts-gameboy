import { Gameboy } from "./Gameboy.js";
import { Memory } from "./Memory.js";
import { uint8 } from "./uint8.js";
import { Register, CombinedRegister } from "./Registers.js";
import { CPUFlags } from "./CPUFlags.js";
import { uint16 } from "./uint16.js";

export class CPU {
    parent: Gameboy;
    memory: Memory;
    flags: CPUFlags; // set members directly, but also can return a uint16 and be set by a uint16
    registers : { [key: string]: Register | CombinedRegister };
    sp = new uint16(0); // stack pointer
    pc = new uint16(0); // program counter
    cycles = 0;

    constructor(_parent){
        this.parent = _parent;
        this.memory = this.parent.Memory;
        this.reset();
    }

    reset() {
        this.flags = new CPUFlags();
        this.registers = {
            a: new Register(new uint8(0)),
            b: new Register(new uint8(0)),
            c: new Register(new uint8(0)),
            d: new Register(new uint8(0)),
            e: new Register(new uint8(0)),
            h: new Register(new uint8(0)),
            l: new Register(new uint8(0)),
        };
        // build combined registers
        this.registers.bc = new CombinedRegister(this.registers.b as Register, this.registers.c as Register);
        this.registers.de = new CombinedRegister(this.registers.d as Register, this.registers.e as Register);
        this.registers.hl = new CombinedRegister(this.registers.h as Register, this.registers.l as Register);
        this.sp = new uint16(0);
        this.pc = new uint16(0);
    }

    // base functions used by similar opcodes
    add(a: number, b: number, is8Bit: boolean, includeCarry: boolean){
        const result = a + b + (includeCarry ? this.flags.carry : 0);

        // check for carry
        this.flags.carry = ((is8Bit && result > 0xFF) || (!is8Bit && result > 0xFFFF)) ? 1 : 0;

        // check for halfCarry
        const hCarryRes = (is8Bit) ? (a & 0xF) + (b & 0xF) + (includeCarry ? this.flags.carry : 0) : (a & 0xFFFFF) + (b & 0xFFFFF) + (includeCarry ? this.flags.carry : 0);
        this.flags.halfCarry = ((is8Bit && (hCarryRes & 0x10) === 0x10) || (!is8Bit && (hCarryRes & 0x100000) === 0x100000)) ? 1 : 0;

        // check for zero
        this.flags.zero = (result === 0) ? 1 : 0;

        // unset subtraction
        this.flags.subtraction = 0;

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    sub(a: number, b: number, is8Bit: boolean, includeCarry: boolean){
        const result = a - b - (includeCarry ? this.flags.carry : 0);

        // check for carry
        this.flags.carry = (result < 0) ? 1 : 0;

        // check for halfCarry
        const hCarryRes = (a & 0xF) - (b & 0xF) - (includeCarry ? this.flags.carry : 0);
        this.flags.halfCarry = ((hCarryRes & 0x10) === 0x10) ? 1 : 0;

        // check for zero
        this.flags.zero = (result === 0) ? 1 : 0;

        // unset subtraction
        this.flags.subtraction = 0;

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    and(a: number, b: number){
        const result = a & b;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 1;
        this.flags.carry = 0;

        return new uint8(result);
    }

    decrement(a: number, is8Bit: boolean){
        const result = a - 1;

        if (is8Bit){
            this.flags.zero = (result === 0) ? 1 : 0;
            this.flags.subtraction = 1;

            // check for halfCarry
            const hCarryRes = (a & 0xF) - (1 & 0xF);
            this.flags.halfCarry = ((hCarryRes & 0x10) === 0x10) ? 1 : 0;
        }

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    increment(a: number, is8Bit: boolean){
        const result = a + 1;

        if (is8Bit){
            this.flags.zero = (result === 0) ? 1 : 0;
            this.flags.subtraction = 0;

            // check for halfCarry
            const hCarryRes = (a & 0xF) + (1 & 0xF);
            this.flags.halfCarry = ((hCarryRes & 0x10) === 0x10) ? 1 : 0;
        }

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    or(a: number, b: number){
        const result = a | b;
        
        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    xor(a: number, b: number){
        const result = a ^ b;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    testBit(bit: number, source: number){
        switch(bit){
            case 0:
                this.flags.zero = (source & 0x01) ? 0 : 1;
                break;
            case 1:
                this.flags.zero = (source & 0x02) ? 0 : 1;
                break;
            case 2:
                this.flags.zero = (source & 0x04) ? 0 : 1;
                break;
            case 3:
                this.flags.zero = (source & 0x08) ? 0 : 1;
                break;
            case 4:
                this.flags.zero = (source & 0x10) ? 0 : 1;
                break;
            case 5:
                this.flags.zero = (source & 0x20) ? 0 : 1;
                break;
            case 6:
                this.flags.zero = (source & 0x40) ? 0 : 1;
                break;
            case 7:
                this.flags.zero = (source & 0x80) ? 0 : 1;
                break;
        };
        this.flags.subtraction = 0;
        this.flags.halfCarry = 1;
    }

    resetBit(bit: number, source: number){
        const result = source & (0xFF - bit);
        return new uint8(result);
    }

    setBit(bit: number, source: number){
        let result;
        switch(bit){
            case 0:
                result = source | 0x01;
                break;
            case 1:
                result = source | 0x02;
                break;
            case 2:
                result = source | 0x04;
                break;
            case 3:
                result = source | 0x08;
                break;
            case 4:
                result = source | 0x10;
                break;
            case 5:
                result = source | 0x20;
                break;
            case 6:
                result = source | 0x40;
                break;
            case 7:
                result = source | 0x80;
                break;
        };
        return new uint8(result);
    }

    swap(source: number){
        const result = ((source & 0xF) << 4) | ((source & 0xF0) >> 4);
        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    rotateLeft(a: number, throughCarry: boolean){
        const carryOut = a & 0x80;
        const carryIn = throughCarry ? this.flags.carry : carryOut;
        const result = (a << 1) + carryIn;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    rotateRight(a: number, throughCarry: boolean){
        const carryOut = a & 0x1;
        const carryIn = throughCarry ? (this.flags.carry ? 0x80 : 0) : (carryOut ? 0x80 : 0);
        const result = (a >> 1) + carryIn;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftLeftA(a: number){
        const carryOut = a & 0x80;
        const result = a << 1;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftRightA(a: number){
        const carryOut = a & 0x1;
        const carryIn = (a & 0x80) ? 0x80 : 0;
        const result = (a >> 1) + carryIn;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftRightL(a: number){
        const carryOut = a & 0x1;
        const result = a >> 1;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    jump(addr: number, condition: string, isRelative: boolean){
        switch(condition){
            case 'Z':
                if (this.flags.zero === 0) return;
                break;
            case 'NZ':
                if (this.flags.zero === 1) return;
                break;
            case 'C':
                if (this.flags.carry === 0) return;
                break;
            case 'NC':
                if (this.flags.carry === 1) return;
                break;
        };
        if (isRelative){
            const signedAddr = addr > 127 ? addr - 256 : addr;
            this.pc = new uint16(this.pc.value + signedAddr);
        } else {
            this.pc = new uint16(addr);
        }
    }
}