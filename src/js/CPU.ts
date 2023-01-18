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
    ime = 0; // IME (interrupt) register
    stop = 0; // is CPU stopped
    halt = 0; // is CPU in halt
    cycles = 0;
    ops = {};
    CBOps = {};

    constructor(_parent){
        this.parent = _parent;
        this.memory = this.parent.Memory;
        this.reset();
        this.generateOpsMap();
        this.generateCBOpsMap();
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
        this.ime = 1;
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

    conditionMet(condition: string | null){
        switch(condition){
            case null:
                return true;
            case 'Z':
                if (this.flags.zero === 0) return false;
                break;
            case 'NZ':
                if (this.flags.zero === 1) return false;
                break;
            case 'C':
                if (this.flags.carry === 0) return false;
                break;
            case 'NC':
                if (this.flags.carry === 1) return false;
                break;
        };
        return true;
    }

    jump(addr: number, condition: string | null, isRelative: boolean){
        if (!this.conditionMet(condition)) return false;
        if (isRelative){
            const signedAddr = addr > 127 ? addr - 256 : addr;
            this.pc = new uint16(this.pc.value + signedAddr);
        } else {
            this.pc = new uint16(addr);
        }
        return true;
    }

    getPCByte(){
        return this.memory.r8(this.pc);
    }

    getPC16(){
        return this.memory.r16(this.pc);
    }

    pop16(){
        const v = this.memory.r16(this.sp);
        this.sp.inc(2);
        return v;
    }
    
    pop8(){
        const v = this.memory.r8(this.sp);
        this.sp.inc();
        return v;
    }

    rst(addr: number){
        this.pc.inc(); // move to instruction after CALL
        this.sp.dec(2); // move up the stack pointer for a new 16-bit value
        this.memory.w16(this.sp, this.pc); // store next instruction address to new stack location
        this.jump(addr, null, false); // execute unconditional jump to addr
        this.cycles+=4;
    }

    generateOpsMap(){
        this.ops = {
            // ADC
            '88': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.b.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '89': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.c.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '8A': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.d.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '8B': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.e.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '8C': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.h.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '8D': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.l.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '8E': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '8F': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.a.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            'CE': () => {
                this.pc.inc();
                this.registers.a.value = this.add(this.registers.a.value.value, this.getPCByte().value, true, true);
                this.cycles+=2;
                this.pc.inc();
            },
            // ADD
            '80': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '81': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '82': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '83': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '84': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '85': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '86': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '87': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'C6': () => {
                this.pc.inc();
                this.registers.a.value = this.add(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '09': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.bc.value.value, false, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '19': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.de.value.value, false, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '29': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.hl.value.value, false, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '39': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.sp.value, false, false);
                this.cycles+=2;
                this.pc.inc();
            },
            'E8': () => {
                this.pc.inc();
                const val = this.getPCByte().value;
                const signedVal = val > 127 ? val - 256 : val;
                this.sp = this.add(this.sp.value, signedVal, false, false) as uint16;
                this.cycles+=4;
                this.pc.inc();
            },
            // AND
            'A0': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A1': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A2': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A3': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A4': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A5': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A6': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A7': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'E6': () => {
                this.pc.inc();
                this.registers.a.value = this.and(this.registers.a.value.value, this.getPCByte().value);
                this.cycles+=2;
                this.pc.inc();
            },
            // CP
            'B8': () => {
                this.sub(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'B9': () => {
                this.sub(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BA': () => {
                this.sub(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BB': () => {
                this.sub(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BC': () => {
                this.sub(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BD': () => {
                this.sub(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BE': () => {
                this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'BF': () => {
                this.sub(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'FE': () => {
                this.pc.inc();
                this.sub(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            // DEC
            '05': () => {
                this.registers.b.value = this.decrement(this.registers.b.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '0D': () => {
                this.registers.c.value = this.decrement(this.registers.c.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '15': () => {
                this.registers.d.value = this.decrement(this.registers.d.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '1D': () => {
                this.registers.e.value = this.decrement(this.registers.e.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '25': () => {
                this.registers.h.value = this.decrement(this.registers.h.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '2D': () => {
                this.registers.l.value = this.decrement(this.registers.l.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '35': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.decrement(this.memory.r8(this.registers.hl.value as uint16).value, true) as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '3D': () => {
                this.registers.a.value = this.decrement(this.registers.a.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '0B': () => {
                this.registers.bc.value = this.decrement(this.registers.bc.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '1B': () => {
                this.registers.de.value = this.decrement(this.registers.de.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '2B': () => {
                this.registers.hl.value = this.decrement(this.registers.hl.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '3B': () => {
                this.sp.dec();
                this.cycles+=2;
                this.pc.inc();
            },
            // INC
            '04': () => {
                this.registers.b.value = this.increment(this.registers.b.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '0C': () => {
                this.registers.c.value = this.increment(this.registers.c.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '14': () => {
                this.registers.d.value = this.increment(this.registers.d.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '1C': () => {
                this.registers.e.value = this.increment(this.registers.e.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '24': () => {
                this.registers.h.value = this.increment(this.registers.h.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '2C': () => {
                this.registers.l.value = this.increment(this.registers.l.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '34': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.increment(this.memory.r8(this.registers.hl.value as uint16).value, true) as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '3C': () => {
                this.registers.a.value = this.increment(this.registers.a.value.value, true);
                this.cycles++;
                this.pc.inc();
            },
            '03': () => {
                this.registers.bc.value = this.increment(this.registers.bc.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '13': () => {
                this.registers.de.value = this.increment(this.registers.de.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '23': () => {
                this.registers.hl.value = this.increment(this.registers.hl.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '33': () => {
                this.sp.inc();
                this.cycles+=2;
                this.pc.inc();
            },
            // OR
            'B0': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B1': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B2': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B3': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B4': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B5': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'B6': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B7': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'F6': () => {
                this.pc.inc();
                this.registers.a.value = this.or(this.registers.a.value.value, this.getPCByte().value);
                this.cycles+=2;
                this.pc.inc();
            },
            // SBC
            '98': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.b.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '99': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.c.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '9A': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.d.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '9B': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.e.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '9C': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.h.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '9D': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.l.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            '9E': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '9F': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.a.value.value, true, true);
                this.cycles++;
                this.pc.inc();
            },
            'DE': () => {
                this.pc.inc();
                this.registers.a.value = this.sub(this.registers.a.value.value, this.getPCByte().value, true, true);
                this.cycles+=2;
                this.pc.inc();
            },
            // SUB
            '90': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '91': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '92': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '93': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '94': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '95': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            '96': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '97': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
            },
            'D6': () => {
                this.pc.inc();
                this.registers.a.value = this.sub(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles+=2;
                this.pc.inc();
            },
            // XOR
            'A8': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'A9': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'AA': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'AB': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'AC': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'AD': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'AE': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AF': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            'EE': () => {
                this.pc.inc();
                this.registers.a.value = this.xor(this.registers.a.value.value, this.getPCByte().value);
                this.cycles+=2;
                this.pc.inc();
            },
            // LD r8, r8
            '40': () => {
                this.registers.b.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '41': () => {
                this.registers.b.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '42': () => {
                this.registers.b.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '43': () => {
                this.registers.b.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '44': () => {
                this.registers.b.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '45': () => {
                this.registers.b.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '46': () => {
                this.registers.b.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '47': () => {
                this.registers.b.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '48': () => {
                this.registers.c.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '49': () => {
                this.registers.c.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '4A': () => {
                this.registers.c.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '4B': () => {
                this.registers.c.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '4C': () => {
                this.registers.c.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '4D': () => {
                this.registers.c.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '4E': () => {
                this.registers.c.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '4F': () => {
                this.registers.c.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '50': () => {
                this.registers.d.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '51': () => {
                this.registers.d.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '52': () => {
                this.registers.d.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '53': () => {
                this.registers.d.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '54': () => {
                this.registers.d.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '55': () => {
                this.registers.d.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '56': () => {
                this.registers.d.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '57': () => {
                this.registers.d.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '58': () => {
                this.registers.e.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '59': () => {
                this.registers.e.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '5A': () => {
                this.registers.e.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '5B': () => {
                this.registers.e.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '5C': () => {
                this.registers.e.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '5D': () => {
                this.registers.e.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '5E': () => {
                this.registers.e.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '5F': () => {
                this.registers.e.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '60': () => {
                this.registers.h.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '61': () => {
                this.registers.h.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '62': () => {
                this.registers.h.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '63': () => {
                this.registers.h.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '64': () => {
                this.registers.h.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '65': () => {
                this.registers.h.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '66': () => {
                this.registers.h.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '67': () => {
                this.registers.h.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '68': () => {
                this.registers.l.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '69': () => {
                this.registers.l.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '6A': () => {
                this.registers.l.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '6B': () => {
                this.registers.l.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '6C': () => {
                this.registers.l.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '6D': () => {
                this.registers.l.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '6E': () => {
                this.registers.l.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '6F': () => {
                this.registers.l.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            // LD (HL), r8
            '70': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.b.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '71': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.c.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '72': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.d.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '73': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.e.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '74': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.h.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '75': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.l.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            '77': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.cycles+=3;
                this.pc.inc();
            },
            // LD A, r8
            '78': () => {
                this.registers.a.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '79': () => {
                this.registers.a.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '7A': () => {
                this.registers.a.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '7B': () => {
                this.registers.a.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '7C': () => {
                this.registers.a.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '7D': () => {
                this.registers.a.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
            },
            '7E': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '7F': () => {
                this.registers.a.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
            },
            // LD r16, nn
            '01': () => {
                this.pc.inc();
                this.registers.bc.value = this.getPC16();
                this.cycles+=3;
                this.pc.inc(2);
            },
            '11': () => {
                this.pc.inc();
                this.registers.de.value = this.getPC16();
                this.cycles+=3;
                this.pc.inc(2);
            },
            '21': () => {
                this.pc.inc();
                this.registers.hl.value = this.getPC16();
                this.cycles+=3;
                this.pc.inc(2);
            },
            '31': () => {
                this.pc.inc();
                this.sp = this.getPC16();
                this.cycles+=3;
                this.pc.inc(2);
            },
            // LD (r16), A
            '02': () => {
                this.memory.w8(this.registers.bc.value as uint16, this.registers.a.value as uint8);
                this.cycles+=2;
                this.pc.inc();
            },
            '12': () => {
                this.memory.w8(this.registers.de.value as uint16, this.registers.a.value as uint8);
                this.cycles+=2;
                this.pc.inc();
            },
            // LDI (HLI), A
            '22': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.registers.hl.value.inc(); // inc after
                this.cycles+=2;
                this.pc.inc();
            },
            // LDD (HLI), A
            '32': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.registers.hl.value.dec(); // dec after
                this.cycles+=2;
                this.pc.inc();
            },
            // LD r8, n
            '06': () => {
                this.pc.inc();
                this.registers.b.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '0E': () => {
                this.pc.inc();
                this.registers.c.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '16': () => {
                this.pc.inc();
                this.registers.d.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '1E': () => {
                this.pc.inc();
                this.registers.e.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '26': () => {
                this.pc.inc();
                this.registers.h.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '2E': () => {
                this.pc.inc();
                this.registers.l.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            '36': () => {
                this.pc.inc();
                this.memory.w8(this.registers.hl.value as uint16, this.getPCByte());
                this.cycles+=3;
                this.pc.inc();
            },
            '3E': () => {
                this.pc.inc();
                this.registers.a.value = this.getPCByte();
                this.cycles+=2;
                this.pc.inc();
            },
            // LD (nn), SP
            '08': () => {
                this.pc.inc();
                this.memory.w16(this.getPC16(), this.sp);
                this.cycles+=5;
                this.pc.inc(2);
            },
            // LD A, (r16)
            '0A': () => {
                this.registers.a.value = this.memory.r8(this.registers.bc.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            '1A': () => {
                this.registers.a.value = this.memory.r8(this.registers.de.value as uint16);
                this.cycles+=2;
                this.pc.inc();
            },
            // LDI A, (HL)
            '2A': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.registers.hl.value.inc(); // inc after
                this.cycles+=2;
                this.pc.inc();
            },
            // LDD A, (HL)
            '3A': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.registers.hl.value.dec(); // dec after
                this.cycles+=2;
                this.pc.inc();
            },
            // LDH (nn), A
            'E0': () => {
                this.pc.inc();
                const addr = this.getPC16();
                if (addr.value >= 0xFF00 && addr.value <= 0xFFFF){
                    this.memory.w8(addr, this.registers.a.value as uint8);
                }
                this.cycles+=3;
                this.pc.inc(2);
            },
            // LDH A, (nn)
            'F0': () => {
                this.pc.inc();
                const addr = this.getPC16();
                if (addr.value >= 0xFF00 && addr.value <= 0xFFFF){
                    this.registers.a.value = this.memory.r8(addr);
                }
                this.cycles+=3;
                this.pc.inc(2);
            },
            // LDH (C), A
            'E2': () => {
                this.memory.w8(new uint16(0xFF00 + this.registers.c.value.value), this.registers.a.value as uint8);
                this.cycles+=2;
                this.pc.inc();
            },
            // LDHL SP, d
            'F8': () => {
                this.pc.inc();
                const val = this.getPCByte().value;
                const signedVal = val > 127 ? val - 256 : val;
                this.registers.hl.value = new uint16(this.sp.value + signedVal);
                this.flags.zero = 0;
                this.flags.subtraction = 0;
                this.flags.halfCarry = ((this.sp.value & 0xF) + (signedVal & 0xF) & 0x10) === 0x10 ? 1 : 0;
                this.flags.carry = (this.sp.value + signedVal > 255) ? 1 : 0;
                this.cycles+=3;
                this.pc.inc();
            },
            // LD SP, HL
            'F9': () => {
                this.sp = new uint16(this.registers.hl.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // LD (nn), A
            'EA': () => {
                this.pc.inc();
                this.memory.w8(this.getPC16(), this.registers.a.value as uint8);
                this.cycles+=4;
                this.pc.inc(2);
            },
            // LD A, (nn)
            'FA': () => {
                this.pc.inc();
                this.registers.a.value = this.memory.r8(this.getPC16());
                this.cycles+=4;
                this.pc.inc(2);
            },
            // CALL nn
            'CD': () => {
                this.pc.inc();
                const addr = this.getPC16(); // store nn to addr
                this.pc.inc(2); // move to instruction after CALL
                this.sp.dec(2); // move up the stack pointer for a new 16-bit value
                this.memory.w16(this.sp, this.pc); // store next instruction address to new stack location
                this.jump(addr.value, null, false); // execute unconditional jump to addr
                this.cycles+=6;
            },
            // CALL NZ, nn
            'C4': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'NZ', false)){
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles+=6;
                } else {
                    this.cycles+=3;
                }
            },
            // CALL NC, nn
            'D4': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'NC', false)){
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles+=6;
                } else {
                    this.cycles+=3;
                }
            },
            // CALL Z, nn
            'CC': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'Z', false)){
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles+=6;
                } else {
                    this.cycles+=3;
                }
            },
            // CALL C, nn
            'DC': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'C', false)){
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles+=6;
                } else {
                    this.cycles+=3;
                }
            },
            // JP nn
            'C3': () => {
                this.pc.inc();
                this.jump(this.getPC16().value, null, false);
                this.cycles+=4;
            },
            // JP NZ, nn
            'C2': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'NZ', false)){
                    this.cycles+=4;
                } else {
                    this.cycles+=3;
                }
            },
            // JP NC, nn
            'D2': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'NC', false)){
                    this.cycles+=4;
                } else {
                    this.cycles+=3;
                }
            },
            // JP Z, nn
            'CA': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'Z', false)){
                    this.cycles+=4;
                } else {
                    this.cycles+=3;
                }
            },
            // JP C, nn
            'DA': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'C', false)){
                    this.cycles+=4;
                } else {
                    this.cycles+=3;
                }
            },
            // JP HL
            'E9': () => {
                this.pc = new uint16(this.registers.hl.value.value);
                this.cycles++;
            },
            // JR n
            '18': () => {
                this.pc.inc();
                this.jump(this.getPCByte().value, null, true);
                this.cycles+=3;
            },
            // JR NZ, n
            '20': () => {
                this.pc.inc();
                if (this.jump(this.getPCByte().value, 'NZ', true)){
                    this.cycles+=3;
                } else {
                    this.cycles+=2;
                }
            },
            // JR NC, n
            '30': () => {
                this.pc.inc();
                if (this.jump(this.getPCByte().value, 'NC', true)){
                    this.cycles+=3;
                } else {
                    this.cycles+=2;
                }
            },
            // JR Z, n
            '28': () => {
                this.pc.inc();
                if (this.jump(this.getPCByte().value, 'Z', true)){
                    this.cycles+=3;
                } else {
                    this.cycles+=2;
                }
            },
            // JR C, n
            '38': () => {
                this.pc.inc();
                if (this.jump(this.getPCByte().value, 'C', true)){
                    this.cycles+=3;
                } else {
                    this.cycles+=2;
                }
            },
            // RET NZ
            'C0': () => {
                if (this.conditionMet('NZ')){
                    this.cycles+=5;
                    this.pc = this.pop16();
                } else {
                    this.cycles+=2;
                    this.pc.inc();
                }
            },
            // RET NC
            'D0': () => {
                if (this.conditionMet('NC')){
                    this.cycles+=5;
                    this.pc = this.pop16();
                } else {
                    this.cycles+=2;
                    this.pc.inc();
                }
            },
            // RET Z
            'C8': () => {
                if (this.conditionMet('Z')){
                    this.cycles+=5;
                    this.pc = this.pop16();
                } else {
                    this.cycles+=2;
                    this.pc.inc();
                }
            },
            // RET C
            'D8': () => {
                if (this.conditionMet('C')){
                    this.cycles+=5;
                    this.pc = this.pop16();
                } else {
                    this.cycles+=2;
                    this.pc.inc();
                }
            },
            // RET
            'C9': () => {
                this.cycles+=4;
                this.pc = this.pop16();
            },
            // RETI
            'D9': () => {
                this.ime = 1;
                this.cycles+=4;
                this.pc = this.pop16();
            },
            // RST 0
            'C7': () => {
                this.rst(0x00);
            },
            // RST 10
            'D7': () => {
                this.rst(0x10);
            },
            // RST 20
            'E7': () => {
                this.rst(0x20);
            },
            // RST 30
            'F7': () => {
                this.rst(0x30);
            },
            // RST 8
            'CF': () => {
                this.rst(0x08);
            },
            // RST 18
            'DF': () => {
                this.rst(0x18);
            },
            // RST 28
            'EF': () => {
                this.rst(0x28);
            },
            // RST 38
            'FF': () => {
                this.rst(0x38);
            },
            // CB-Prefix
            'CB': () => {
                this.pc.inc();
                this.CBOps[this.getPCByte().value.toString(16)]();
            },
            // POP
            'C1': () => {
                this.registers.bc.value = this.pop16();
                this.pc.inc();
                this.cycles+=3;
            },
            'D1': () => {
                this.registers.de.value = this.pop16();
                this.pc.inc();
                this.cycles+=3;
            },
            'E1': () => {
                this.registers.hl.value = this.pop16();
                this.pc.inc();
                this.cycles+=3;
            },
            'F1': () => {
                this.flags.value = this.pop8();
                this.registers.a.value = this.pop8();
                this.pc.inc();
                this.cycles+=3;
            },
            // PUSH
            'C5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.bc.value as uint16);
                this.pc.inc();
                this.cycles+=4;
            },
            'D5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.de.value as uint16);
                this.pc.inc();
                this.cycles+=4;
            },
            'E5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.hl.value as uint16);
                this.pc.inc();
                this.cycles+=4;
            },
            'F5': () => {
                this.sp.dec();
                this.memory.w8(this.sp, this.registers.a.value as uint8);
                this.sp.dec();
                this.memory.w8(this.sp, this.flags.value);
                this.pc.inc();
                this.cycles+=4;
            },
            // CCF
            '3F': () => {
                this.flags.subtraction = 0;
                this.flags.halfCarry = 0;
                this.flags.carry = (this.flags.carry) ? 0 : 1;
                this.pc.inc();
                this.cycles++;
            },
            // CPL
            '2F': () => {
                this.registers.a.value = new uint8(~this.registers.a.value.value);
                this.flags.subtraction = 1;
                this.flags.halfCarry = 1;
                this.pc.inc();
                this.cycles++;
            },
            // DAA (idfk, ripped from cpp example found online) -- basically make hex values look like base 10 (0x9, 0xA --> 0x10, 0xB --> 0x11)
            '27': () => {
                let val = this.registers.a.value.value;

                if (((val & 0x0F) > 0x09) || (this.flags.halfCarry === 1))  {
                        val  += 0x06;
                        this.flags.carry =  (val > 0xFF) ? 1 : 0;
                        this.flags.halfCarry = ((val & 0xF0) != 0) ? 1 : 0;
                };
                if ((val > 0x99) || (this.flags.halfCarry === 1))  {
                        val  += 0x60;
                        this.flags.carry = 1;
                }
                this.registers.a.value = new uint8(val);
                this.pc.inc();
                this.cycles++;
            },
            // DI
            'F3': () => {
                this.ime = 0;
                this.pc.inc();
                this.cycles++;
            },
            // EI
            'FB': () => {
                this.ime = 1;
                this.pc.inc();
                this.cycles++;
            },
            // HALT
            '76': () => {
                this.halt = 1;
                this.pc.inc();
                this.cycles++;
            },
            // NOP
            '00': () => {
                this.pc.inc();
                this.cycles++;
            },
            // SCF
            '37': () => {
                this.flags.subtraction = 0;
                this.flags.halfCarry = 0;
                this.flags.carry = 1;
                this.pc.inc();
                this.cycles++;
            },
            // STOP
            '10': () => {
                this.stop = 1;
                this.pc.inc();
            },
        };
    }

    generateCBOpsMap(){
        this.CBOps = {
            // BIT
            '40': () => {
                this.testBit(0, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '41': () => {
                this.testBit(0, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '42': () => {
                this.testBit(0, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '43': () => {
                this.testBit(0, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '44': () => {
                this.testBit(0, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '45': () => {
                this.testBit(0, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '46': () => {
                this.testBit(0, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '47': () => {
                this.testBit(0, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '48': () => {
                this.testBit(1, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '49': () => {
                this.testBit(1, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '4A': () => {
                this.testBit(1, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '4B': () => {
                this.testBit(1, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '4C': () => {
                this.testBit(1, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '4D': () => {
                this.testBit(1, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '4E': () => {
                this.testBit(1, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '4F': () => {
                this.testBit(1, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '50': () => {
                this.testBit(2, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '51': () => {
                this.testBit(2, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '52': () => {
                this.testBit(2, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '53': () => {
                this.testBit(2, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '54': () => {
                this.testBit(2, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '55': () => {
                this.testBit(2, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '56': () => {
                this.testBit(2, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '57': () => {
                this.testBit(2, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '58': () => {
                this.testBit(3, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '59': () => {
                this.testBit(3, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '5A': () => {
                this.testBit(3, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '5B': () => {
                this.testBit(3, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '5C': () => {
                this.testBit(3, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '5D': () => {
                this.testBit(3, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '5E': () => {
                this.testBit(3, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '5F': () => {
                this.testBit(3, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '60': () => {
                this.testBit(4, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '61': () => {
                this.testBit(4, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '62': () => {
                this.testBit(4, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '63': () => {
                this.testBit(4, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '64': () => {
                this.testBit(4, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '65': () => {
                this.testBit(4, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '66': () => {
                this.testBit(4, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '67': () => {
                this.testBit(4, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '68': () => {
                this.testBit(5, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '69': () => {
                this.testBit(5, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '6A': () => {
                this.testBit(5, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '6B': () => {
                this.testBit(5, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '6C': () => {
                this.testBit(5, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '6D': () => {
                this.testBit(5, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '6E': () => {
                this.testBit(5, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '6F': () => {
                this.testBit(5, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '70': () => {
                this.testBit(6, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '71': () => {
                this.testBit(6, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '72': () => {
                this.testBit(6, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '73': () => {
                this.testBit(6, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '74': () => {
                this.testBit(6, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '75': () => {
                this.testBit(6, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '76': () => {
                this.testBit(6, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '77': () => {
                this.testBit(6, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '78': () => {
                this.testBit(7, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '79': () => {
                this.testBit(7, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '7A': () => {
                this.testBit(7, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '7B': () => {
                this.testBit(7, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '7C': () => {
                this.testBit(7, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '7D': () => {
                this.testBit(7, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '7E': () => {
                this.testBit(7, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles+=3;
                this.pc.inc();
            },
            '7F': () => {
                this.testBit(7, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // RES
            '80': () => {
                this.registers.b.value = this.resetBit(0, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '81': () => {
                this.registers.c.value = this.resetBit(0, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '82': () => {
                this.registers.d.value = this.resetBit(0, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '83': () => {
                this.registers.e.value = this.resetBit(0, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '84': () => {
                this.registers.h.value = this.resetBit(0, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '85': () => {
                this.registers.l.value = this.resetBit(0, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '86': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(0, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '87': () => {
                this.registers.a.value = this.resetBit(0, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '88': () => {
                this.registers.b.value = this.resetBit(1, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '89': () => {
                this.registers.c.value = this.resetBit(1, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '8A': () => {
                this.registers.d.value = this.resetBit(1, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '8B': () => {
                this.registers.e.value = this.resetBit(1, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '8C': () => {
                this.registers.h.value = this.resetBit(1, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '8D': () => {
                this.registers.l.value = this.resetBit(1, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '8E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(1, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '8F': () => {
                this.registers.a.value = this.resetBit(1, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '90': () => {
                this.registers.b.value = this.resetBit(2, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '91': () => {
                this.registers.c.value = this.resetBit(2, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '92': () => {
                this.registers.d.value = this.resetBit(2, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '93': () => {
                this.registers.e.value = this.resetBit(2, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '94': () => {
                this.registers.h.value = this.resetBit(2, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '95': () => {
                this.registers.l.value = this.resetBit(2, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '96': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(2, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '97': () => {
                this.registers.a.value = this.resetBit(2, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '98': () => {
                this.registers.b.value = this.resetBit(3, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '99': () => {
                this.registers.c.value = this.resetBit(3, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '9A': () => {
                this.registers.d.value = this.resetBit(3, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '9B': () => {
                this.registers.e.value = this.resetBit(3, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '9C': () => {
                this.registers.h.value = this.resetBit(3, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '9D': () => {
                this.registers.l.value = this.resetBit(3, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '9E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(3, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '9F': () => {
                this.registers.a.value = this.resetBit(3, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A0': () => {
                this.registers.b.value = this.resetBit(4, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A1': () => {
                this.registers.c.value = this.resetBit(4, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A2': () => {
                this.registers.d.value = this.resetBit(4, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A3': () => {
                this.registers.e.value = this.resetBit(4, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A4': () => {
                this.registers.h.value = this.resetBit(4, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A5': () => {
                this.registers.l.value = this.resetBit(4, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(4, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'A7': () => {
                this.registers.a.value = this.resetBit(4, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A8': () => {
                this.registers.b.value = this.resetBit(5, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'A9': () => {
                this.registers.c.value = this.resetBit(5, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AA': () => {
                this.registers.d.value = this.resetBit(5, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AB': () => {
                this.registers.e.value = this.resetBit(5, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AC': () => {
                this.registers.h.value = this.resetBit(5, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AD': () => {
                this.registers.l.value = this.resetBit(5, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'AE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(5, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'AF': () => {
                this.registers.a.value = this.resetBit(5, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B0': () => {
                this.registers.b.value = this.resetBit(6, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B1': () => {
                this.registers.c.value = this.resetBit(6, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B2': () => {
                this.registers.d.value = this.resetBit(6, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B3': () => {
                this.registers.e.value = this.resetBit(6, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B4': () => {
                this.registers.h.value = this.resetBit(6, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B5': () => {
                this.registers.l.value = this.resetBit(6, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(6, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'B7': () => {
                this.registers.a.value = this.resetBit(6, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B8': () => {
                this.registers.b.value = this.resetBit(7, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'B9': () => {
                this.registers.c.value = this.resetBit(7, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'BA': () => {
                this.registers.d.value = this.resetBit(7, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'BB': () => {
                this.registers.e.value = this.resetBit(7, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'BC': () => {
                this.registers.h.value = this.resetBit(7, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'BD': () => {
                this.registers.l.value = this.resetBit(7, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'BE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(7, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'BF': () => {
                this.registers.a.value = this.resetBit(7, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // SET
            'C0': () => {
                this.registers.b.value = this.setBit(0, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C1': () => {
                this.registers.c.value = this.setBit(0, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C2': () => {
                this.registers.d.value = this.setBit(0, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C3': () => {
                this.registers.e.value = this.setBit(0, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C4': () => {
                this.registers.h.value = this.setBit(0, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C5': () => {
                this.registers.l.value = this.setBit(0, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(0, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'C7': () => {
                this.registers.a.value = this.setBit(0, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C8': () => {
                this.registers.b.value = this.setBit(1, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'C9': () => {
                this.registers.c.value = this.setBit(1, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'CA': () => {
                this.registers.d.value = this.setBit(1, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'CB': () => {
                this.registers.e.value = this.setBit(1, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'CC': () => {
                this.registers.h.value = this.setBit(1, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'CD': () => {
                this.registers.l.value = this.setBit(1, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'CE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(1, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'CF': () => {
                this.registers.a.value = this.setBit(1, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D0': () => {
                this.registers.b.value = this.setBit(2, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D1': () => {
                this.registers.c.value = this.setBit(2, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D2': () => {
                this.registers.d.value = this.setBit(2, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D3': () => {
                this.registers.e.value = this.setBit(2, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D4': () => {
                this.registers.h.value = this.setBit(2, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D5': () => {
                this.registers.l.value = this.setBit(2, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(2, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'D7': () => {
                this.registers.a.value = this.setBit(2, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D8': () => {
                this.registers.b.value = this.setBit(3, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'D9': () => {
                this.registers.c.value = this.setBit(3, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'DA': () => {
                this.registers.d.value = this.setBit(3, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'DB': () => {
                this.registers.e.value = this.setBit(3, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'DC': () => {
                this.registers.h.value = this.setBit(3, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'DD': () => {
                this.registers.l.value = this.setBit(3, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'DE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(3, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'DF': () => {
                this.registers.a.value = this.setBit(3, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E0': () => {
                this.registers.b.value = this.setBit(4, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E1': () => {
                this.registers.c.value = this.setBit(4, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E2': () => {
                this.registers.d.value = this.setBit(4, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E3': () => {
                this.registers.e.value = this.setBit(4, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E4': () => {
                this.registers.h.value = this.setBit(4, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E5': () => {
                this.registers.l.value = this.setBit(4, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(4, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'E7': () => {
                this.registers.a.value = this.setBit(4, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E8': () => {
                this.registers.b.value = this.setBit(5, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'E9': () => {
                this.registers.c.value = this.setBit(5, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'EA': () => {
                this.registers.d.value = this.setBit(5, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'EB': () => {
                this.registers.e.value = this.setBit(5, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'EC': () => {
                this.registers.h.value = this.setBit(5, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'ED': () => {
                this.registers.l.value = this.setBit(5, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'EE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(5, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'EF': () => {
                this.registers.a.value = this.setBit(5, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F0': () => {
                this.registers.b.value = this.setBit(6, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F1': () => {
                this.registers.c.value = this.setBit(6, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F2': () => {
                this.registers.d.value = this.setBit(6, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F3': () => {
                this.registers.e.value = this.setBit(6, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F4': () => {
                this.registers.h.value = this.setBit(6, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F5': () => {
                this.registers.l.value = this.setBit(6, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(6, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'F7': () => {
                this.registers.a.value = this.setBit(6, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F8': () => {
                this.registers.b.value = this.setBit(7, this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'F9': () => {
                this.registers.c.value = this.setBit(7, this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'FA': () => {
                this.registers.d.value = this.setBit(7, this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'FB': () => {
                this.registers.e.value = this.setBit(7, this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'FC': () => {
                this.registers.h.value = this.setBit(7, this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'FD': () => {
                this.registers.l.value = this.setBit(7, this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            'FE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(7, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            'FF': () => {
                this.registers.a.value = this.setBit(7, this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // SWAP
            '30': () => {
                this.registers.b.value = this.swap(this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '31': () => {
                this.registers.c.value = this.swap(this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '32': () => {
                this.registers.d.value = this.swap(this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '33': () => {
                this.registers.e.value = this.swap(this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '34': () => {
                this.registers.h.value = this.swap(this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '35': () => {
                this.registers.l.value = this.swap(this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '36': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.swap(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '37': () => {
                this.registers.a.value = this.swap(this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // RL
            '10': () => {
                this.registers.b.value = this.rotateLeft(this.registers.b.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '11': () => {
                this.registers.c.value = this.rotateLeft(this.registers.c.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '12': () => {
                this.registers.d.value = this.rotateLeft(this.registers.d.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '13': () => {
                this.registers.e.value = this.rotateLeft(this.registers.e.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '14': () => {
                this.registers.h.value = this.rotateLeft(this.registers.h.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '15': () => {
                this.registers.l.value = this.rotateLeft(this.registers.l.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '16': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateLeft(this.memory.r8(this.registers.hl.value as uint16).value, true));
                this.cycles+=4;
                this.pc.inc();
            },
            '17': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            // RLC
            '00': () => {
                this.registers.b.value = this.rotateLeft(this.registers.b.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '01': () => {
                this.registers.c.value = this.rotateLeft(this.registers.c.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '02': () => {
                this.registers.d.value = this.rotateLeft(this.registers.d.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '03': () => {
                this.registers.e.value = this.rotateLeft(this.registers.e.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '04': () => {
                this.registers.h.value = this.rotateLeft(this.registers.h.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '05': () => {
                this.registers.l.value = this.rotateLeft(this.registers.l.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '06': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateLeft(this.memory.r8(this.registers.hl.value as uint16).value, false));
                this.cycles+=4;
                this.pc.inc();
            },
            '07': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            // RR
            '18': () => {
                this.registers.b.value = this.rotateRight(this.registers.b.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '19': () => {
                this.registers.c.value = this.rotateRight(this.registers.c.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '1A': () => {
                this.registers.d.value = this.rotateRight(this.registers.d.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '1B': () => {
                this.registers.e.value = this.rotateRight(this.registers.e.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '1C': () => {
                this.registers.h.value = this.rotateRight(this.registers.h.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '1D': () => {
                this.registers.l.value = this.rotateRight(this.registers.l.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            '1E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateRight(this.memory.r8(this.registers.hl.value as uint16).value, true));
                this.cycles+=4;
                this.pc.inc();
            },
            '1F': () => {
                this.registers.a.value = this.rotateRight(this.registers.a.value.value, true);
                this.cycles+=2;
                this.pc.inc();
            },
            // RRC
            '08': () => {
                this.registers.b.value = this.rotateRight(this.registers.b.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '09': () => {
                this.registers.c.value = this.rotateRight(this.registers.c.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '0A': () => {
                this.registers.d.value = this.rotateRight(this.registers.d.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '0B': () => {
                this.registers.e.value = this.rotateRight(this.registers.e.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '0C': () => {
                this.registers.h.value = this.rotateRight(this.registers.h.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '0D': () => {
                this.registers.l.value = this.rotateRight(this.registers.l.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            '0E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateRight(this.memory.r8(this.registers.hl.value as uint16).value, false));
                this.cycles+=4;
                this.pc.inc();
            },
            '0F': () => {
                this.registers.a.value = this.rotateRight(this.registers.a.value.value, false);
                this.cycles+=2;
                this.pc.inc();
            },
            // SLA
            '20': () => {
                this.registers.b.value = this.shiftLeftA(this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '21': () => {
                this.registers.c.value = this.shiftLeftA(this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '22': () => {
                this.registers.d.value = this.shiftLeftA(this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '23': () => {
                this.registers.e.value = this.shiftLeftA(this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '24': () => {
                this.registers.h.value = this.shiftLeftA(this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '25': () => {
                this.registers.l.value = this.shiftLeftA(this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '26': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftLeftA(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '27': () => {
                this.registers.a.value = this.shiftLeftA(this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // SRA
            '28': () => {
                this.registers.b.value = this.shiftRightA(this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '29': () => {
                this.registers.c.value = this.shiftRightA(this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '2A': () => {
                this.registers.d.value = this.shiftRightA(this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '2B': () => {
                this.registers.e.value = this.shiftRightA(this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '2C': () => {
                this.registers.h.value = this.shiftRightA(this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '2D': () => {
                this.registers.l.value = this.shiftRightA(this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '2E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftRightA(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '2F': () => {
                this.registers.a.value = this.shiftRightA(this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            // SRL
            '38': () => {
                this.registers.b.value = this.shiftRightL(this.registers.b.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '39': () => {
                this.registers.c.value = this.shiftRightL(this.registers.c.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '3A': () => {
                this.registers.d.value = this.shiftRightL(this.registers.d.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '3B': () => {
                this.registers.e.value = this.shiftRightL(this.registers.e.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '3C': () => {
                this.registers.h.value = this.shiftRightL(this.registers.h.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '3D': () => {
                this.registers.l.value = this.shiftRightL(this.registers.l.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
            '3E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftRightL(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles+=4;
                this.pc.inc();
            },
            '3F': () => {
                this.registers.a.value = this.shiftRightL(this.registers.a.value.value);
                this.cycles+=2;
                this.pc.inc();
            },
        };
    }
}