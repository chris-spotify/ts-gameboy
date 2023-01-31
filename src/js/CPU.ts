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
    registers: { [key: string]: Register | CombinedRegister };
    sp = new uint16(0); // stack pointer
    pc = new uint16(0); // program counter
    ime = 0; // IME (interrupt) register
    stop = 0; // is CPU stopped
    halt = 0; // is CPU in halt
    cycles = 0;
    ops = {};
    CBOps = {};
    debug = false;
    debugLogs = [];

    constructor(_parent) {
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
        this.registers.bc = new CombinedRegister(this.registers.c as Register, this.registers.b as Register);
        this.registers.de = new CombinedRegister(this.registers.e as Register, this.registers.d as Register);
        this.registers.hl = new CombinedRegister(this.registers.l as Register, this.registers.h as Register);
        this.sp = new uint16(0xFFFE);
        this.pc = new uint16(0);
        this.ime = 1;
    }

    // base functions used by similar opcodes
    add(a: number, b: number, is8Bit: boolean, includeCarry: boolean) {
        const result = a + b + (includeCarry ? this.flags.carry : 0);

        // check for halfCarry
        if (is8Bit){
            if (includeCarry){
                this.flags.halfCarry = ((a & 0xF) + (b & 0xF) + (this.flags.carry) > 0xF) ? 1 : 0;
            } else {
                this.flags.halfCarry = ((result & 0xF) < (a & 0xF)) ? 1 : 0;
            }
        } else {
            this.flags.halfCarry = ((a & 0xFFF) > (result & 0xFFF)) ? 1 : 0;
        }

        // check for carry
        this.flags.carry = ((is8Bit && result > 0xFF) || (!is8Bit && result > 0xFFFF)) ? 1 : 0;

        // handle over/underflow
        const finalResult = is8Bit ? new uint8(result) : new uint16(result);

        // check for zero
        this.flags.zero = (finalResult.value === 0) ? 1 : 0;

        // unset subtraction
        this.flags.subtraction = 0;

        return finalResult;
    }

    sub(a: number, b: number, is8Bit: boolean, includeCarry: boolean) {
        const result = a - b - (includeCarry ? this.flags.carry : 0);

        // check for halfCarry
        if (is8Bit){
            if (includeCarry){
                this.flags.halfCarry = ((a & 0xF) - (b & 0xF) - (this.flags.carry) < 0) ? 1 : 0;
            } else {
                this.flags.halfCarry = ((a & 0xF) < (result & 0xF)) ? 1 : 0;
            }
        }

        // check for carry
        this.flags.carry = (result < 0) ? 1 : 0;

        // handle over/underflow
        const finalResult = is8Bit ? new uint8(result) : new uint16(result);

        // check for zero
        this.flags.zero = (finalResult.value === 0) ? 1 : 0;

        // set subtraction
        this.flags.subtraction = 1;

        return finalResult;
    }

    and(a: number, b: number) {
        const result = a & b;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 1;
        this.flags.carry = 0;

        return new uint8(result);
    }

    decrement(a: number, is8Bit: boolean) {
        const result = a - 1;

        if (is8Bit) {
            this.flags.zero = (result === 0) ? 1 : 0;
            this.flags.subtraction = 1;

            // check for halfCarry
            const hCarryRes = (a & 0xF) - (1 & 0xF);
            this.flags.halfCarry = ((hCarryRes & 0x10) === 0x10) ? 1 : 0;
        }

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    increment(a: number, is8Bit: boolean) {
        const result = a + 1;

        if (is8Bit) {
            this.flags.zero = (result === 0) ? 1 : 0;
            this.flags.subtraction = 0;

            // check for halfCarry
            const hCarryRes = (a & 0xF) + (1 & 0xF);
            this.flags.halfCarry = ((hCarryRes & 0x10) === 0x10) ? 1 : 0;
        }

        return is8Bit ? new uint8(result) : new uint16(result);
    }

    or(a: number, b: number) {
        const result = a | b;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    xor(a: number, b: number) {
        const result = a ^ b;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    testBit(bit: number, source: number) {
        switch (bit) {
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

    resetBit(bit: number, source: number) {
        let result;
        switch(bit){
            case 0:
                result = source & 0xFE;
                break;
            case 1:
                result = source & 0xFD;
                break;
            case 2:
                result = source & 0xFB;
                break;
            case 3:
                result = source & 0xF7;
                break;
            case 4:
                result = source & 0xEF;
                break;
            case 5:
                result = source & 0xDF;
                break;
            case 6:
                result = source & 0xBF;
                break;
            case 7:
                result = source & 0x7F;
                break;
        };
        return new uint8(result);
    }

    setBit(bit: number, source: number) {
        let result;
        switch (bit) {
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

    swap(source: number) {
        const result = ((source & 0xF) << 4) | ((source & 0xF0) >> 4);
        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        this.flags.carry = 0;
        return new uint8(result);
    }

    rotateLeft(a: number, throughCarry: boolean) {
        const newCarry = a > 0x7F ? 1 : 0;
        if (!throughCarry) this.flags.carry = newCarry;
        const result = ((a << 1) & 0xFF) | (this.flags.carry ? 1 : 0); // ((parentObj.registerB << 1) & 0xFF) | ((parentObj.FCarry) ? 1 : 0);
        if (throughCarry) this.flags.carry = newCarry;
        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    rotateRight(a: number, throughCarry: boolean) {
        const carryOut = a & 0x1;
        const carryIn = throughCarry ? (this.flags.carry ? 0x80 : 0) : (carryOut ? 0x80 : 0);
        const result = (a >> 1) + carryIn;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftLeftA(a: number) {
        const carryOut = a & 0x80;
        const result = a << 1;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftRightA(a: number) {
        const carryOut = a & 0x1;
        const carryIn = (a & 0x80) ? 0x80 : 0;
        const result = (a >> 1) + carryIn;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    shiftRightL(a: number) {
        const carryOut = a & 0x1;
        const result = a >> 1;

        this.flags.zero = (result === 0) ? 1 : 0;
        this.flags.carry = carryOut ? 1 : 0;
        this.flags.subtraction = 0;
        this.flags.halfCarry = 0;
        return new uint8(result);
    }

    conditionMet(condition: string | null) {
        switch (condition) {
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

    jump(addr: number, condition: string | null, isRelative: boolean) {
        if (!this.conditionMet(condition)) return false;
        if (isRelative) {
            const signedAddr = addr > 127 ? addr - 256 : addr;
            this.pc = new uint16(this.pc.value + signedAddr);
        } else {
            this.pc = new uint16(addr);
        }
        return true;
    }

    getPCByte() {
        return this.memory.r8(this.pc);
    }

    getPC16() {
        return this.memory.r16(this.pc);
    }

    pop16() {
        const v = this.memory.r16(this.sp);
        this.sp.inc(2);
        return v;
    }

    pop8() {
        const v = this.memory.r8(this.sp);
        this.sp.inc();
        return v;
    }

    rst(addr: number) {
        this.pc.inc(); // move to instruction after CALL
        this.sp.dec(2); // move up the stack pointer for a new 16-bit value
        this.memory.w16(this.sp, this.pc); // store next instruction address to new stack location
        this.jump(addr, null, false); // execute unconditional jump to addr
        this.cycles += 4;
        if (this.debug) this.debugLogs.push(`RST ${addr.toString(16).padStart(4, '0')}`);
    }

    generateOpsMap() {
        this.ops = {
            // ADC
            '88': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.b.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC B');
            },
            '89': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.c.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC C');
            },
            '8A': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.d.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC D');
            },
            '8B': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.e.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC E');
            },
            '8C': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.h.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC H');
            },
            '8D': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.l.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC L');
            },
            '8E': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC (HL)');
            },
            '8F': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.a.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC A');
            },
            'CE': () => {
                this.pc.inc();
                this.registers.a.value = this.add(this.registers.a.value.value, this.getPCByte().value, true, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADC n');
            },
            // ADD
            '80': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD B');
            },
            '81': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD C');
            },
            '82': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD D');
            },
            '83': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD E');
            },
            '84': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD H');
            },
            '85': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD L');
            },
            '86': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD (HL)');
            },
            '87': () => {
                this.registers.a.value = this.add(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD A');
            },
            'C6': () => {
                this.pc.inc();
                this.registers.a.value = this.add(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD n');
            },
            '09': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.bc.value.value, false, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD HL, BC');
            },
            '19': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.de.value.value, false, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD HL, DE');
            },
            '29': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.registers.hl.value.value, false, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD HL, HL');
            },
            '39': () => {
                this.registers.hl.value = this.add(this.registers.hl.value.value, this.sp.value, false, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD HL, SP');
            },
            'E8': () => {
                this.pc.inc();
                const val = this.getPCByte().value;
                const signedVal = val > 127 ? val - 256 : val;
                this.sp = this.add(this.sp.value, signedVal, false, false) as uint16;
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('ADD SP, d');
            },
            // AND
            'A0': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND B');
            },
            'A1': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND C');
            },
            'A2': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND D');
            },
            'A3': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND E');
            },
            'A4': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND H');
            },
            'A5': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND L');
            },
            'A6': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND (HL)');
            },
            'A7': () => {
                this.registers.a.value = this.and(this.registers.a.value.value, this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND A');
            },
            'E6': () => {
                this.pc.inc();
                this.registers.a.value = this.and(this.registers.a.value.value, this.getPCByte().value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('AND n');
            },
            // CP
            'B8': () => {
                this.sub(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP B');
            },
            'B9': () => {
                this.sub(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP C');
            },
            'BA': () => {
                this.sub(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP D');
            },
            'BB': () => {
                this.sub(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP E');
            },
            'BC': () => {
                this.sub(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP H');
            },
            'BD': () => {
                this.sub(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP L');
            },
            'BE': () => {
                this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP (HL)');
            },
            'BF': () => {
                this.sub(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP A');
            },
            'FE': () => {
                this.pc.inc();
                this.sub(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('CP n');
            },
            // DEC
            '05': () => {
                this.registers.b.value = this.decrement(this.registers.b.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC B');
            },
            '0D': () => {
                this.registers.c.value = this.decrement(this.registers.c.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC C');
            },
            '15': () => {
                this.registers.d.value = this.decrement(this.registers.d.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC D');
            },
            '1D': () => {
                this.registers.e.value = this.decrement(this.registers.e.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC E');
            },
            '25': () => {
                this.registers.h.value = this.decrement(this.registers.h.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC H');
            },
            '2D': () => {
                this.registers.l.value = this.decrement(this.registers.l.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC L');
            },
            '35': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.decrement(this.memory.r8(this.registers.hl.value as uint16).value, true) as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC (HL)');
            },
            '3D': () => {
                this.registers.a.value = this.decrement(this.registers.a.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC A');
            },
            '0B': () => {
                this.registers.bc.value = this.decrement(this.registers.bc.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC BC');
            },
            '1B': () => {
                this.registers.de.value = this.decrement(this.registers.de.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC DE');
            },
            '2B': () => {
                this.registers.hl.value = this.decrement(this.registers.hl.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC HL');
            },
            '3B': () => {
                this.sp.dec();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('DEC SP');
            },
            // INC
            '04': () => {
                this.registers.b.value = this.increment(this.registers.b.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC B');
            },
            '0C': () => {
                this.registers.c.value = this.increment(this.registers.c.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC C');
            },
            '14': () => {
                this.registers.d.value = this.increment(this.registers.d.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC D');
            },
            '1C': () => {
                this.registers.e.value = this.increment(this.registers.e.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC E');
            },
            '24': () => {
                this.registers.h.value = this.increment(this.registers.h.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC H');
            },
            '2C': () => {
                this.registers.l.value = this.increment(this.registers.l.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC L');
            },
            '34': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.increment(this.memory.r8(this.registers.hl.value as uint16).value, true) as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC (HL)');
            },
            '3C': () => {
                this.registers.a.value = this.increment(this.registers.a.value.value, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC A');
            },
            '03': () => {
                this.registers.bc.value = this.increment(this.registers.bc.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC BC');
            },
            '13': () => {
                this.registers.de.value = this.increment(this.registers.de.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC DE');
            },
            '23': () => {
                this.registers.hl.value = this.increment(this.registers.hl.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC HL');
            },
            '33': () => {
                this.sp.inc();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('INC SP');
            },
            // OR
            'B0': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR B');
            },
            'B1': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR C');
            },
            'B2': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR D');
            },
            'B3': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR E');
            },
            'B4': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR H');
            },
            'B5': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR L');
            },
            'B6': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR (HL)');
            },
            'B7': () => {
                this.registers.a.value = this.or(this.registers.a.value.value, this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR A');
            },
            'F6': () => {
                this.pc.inc();
                this.registers.a.value = this.or(this.registers.a.value.value, this.getPCByte().value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('OR n');
            },
            // SBC
            '98': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.b.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC B');
            },
            '99': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.c.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC C');
            },
            '9A': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.d.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC D');
            },
            '9B': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.e.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC E');
            },
            '9C': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.h.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC H');
            },
            '9D': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.l.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC L');
            },
            '9E': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC (HL)');
            },
            '9F': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.a.value.value, true, true);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC A');
            },
            'DE': () => {
                this.pc.inc();
                this.registers.a.value = this.sub(this.registers.a.value.value, this.getPCByte().value, true, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SBC n');
            },
            // SUB
            '90': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.b.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB B');
            },
            '91': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.c.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB C');
            },
            '92': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.d.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB D');
            },
            '93': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.e.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB E');
            },
            '94': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.h.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB H');
            },
            '95': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.l.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB L');
            },
            '96': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value, true, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB (HL)');
            },
            '97': () => {
                this.registers.a.value = this.sub(this.registers.a.value.value, this.registers.a.value.value, true, false);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB A');
            },
            'D6': () => {
                this.pc.inc();
                this.registers.a.value = this.sub(this.registers.a.value.value, this.getPCByte().value, true, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SUB n');
            },
            // XOR
            'A8': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR B');
            },
            'A9': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR C');
            },
            'AA': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR D');
            },
            'AB': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR E');
            },
            'AC': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR H');
            },
            'AD': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR L');
            },
            'AE': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR (HL)');
            },
            'AF': () => {
                this.registers.a.value = this.xor(this.registers.a.value.value, this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR A');
            },
            'EE': () => {
                this.pc.inc();
                this.registers.a.value = this.xor(this.registers.a.value.value, this.getPCByte().value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('XOR n');
            },
            // LD r8, r8
            '40': () => {
                this.registers.b.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, B');
            },
            '41': () => {
                this.registers.b.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, C');
            },
            '42': () => {
                this.registers.b.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, D');
            },
            '43': () => {
                this.registers.b.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, E');
            },
            '44': () => {
                this.registers.b.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, H');
            },
            '45': () => {
                this.registers.b.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, L');
            },
            '46': () => {
                this.registers.b.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, (HL)');
            },
            '47': () => {
                this.registers.b.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, A');
            },
            '48': () => {
                this.registers.c.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, B');
            },
            '49': () => {
                this.registers.c.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, C');
            },
            '4A': () => {
                this.registers.c.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, D');
            },
            '4B': () => {
                this.registers.c.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, E');
            },
            '4C': () => {
                this.registers.c.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, H');
            },
            '4D': () => {
                this.registers.c.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, L');
            },
            '4E': () => {
                this.registers.c.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, (HL)');
            },
            '4F': () => {
                this.registers.c.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C, A');
            },
            '50': () => {
                this.registers.d.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, B');
            },
            '51': () => {
                this.registers.d.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, C');
            },
            '52': () => {
                this.registers.d.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, D');
            },
            '53': () => {
                this.registers.d.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, E');
            },
            '54': () => {
                this.registers.d.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, H');
            },
            '55': () => {
                this.registers.d.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, L');
            },
            '56': () => {
                this.registers.d.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, (HL)');
            },
            '57': () => {
                this.registers.d.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, A');
            },
            '58': () => {
                this.registers.e.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, B');
            },
            '59': () => {
                this.registers.e.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, C');
            },
            '5A': () => {
                this.registers.e.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, D');
            },
            '5B': () => {
                this.registers.e.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, E');
            },
            '5C': () => {
                this.registers.e.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, H');
            },
            '5D': () => {
                this.registers.e.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, L');
            },
            '5E': () => {
                this.registers.e.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, (HL)');
            },
            '5F': () => {
                this.registers.e.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, A');
            },
            '60': () => {
                this.registers.h.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, B');
            },
            '61': () => {
                this.registers.h.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, C');
            },
            '62': () => {
                this.registers.h.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, D');
            },
            '63': () => {
                this.registers.h.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, E');
            },
            '64': () => {
                this.registers.h.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, H');
            },
            '65': () => {
                this.registers.h.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, L');
            },
            '66': () => {
                this.registers.h.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, (HL)');
            },
            '67': () => {
                this.registers.h.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, A');
            },
            '68': () => {
                this.registers.l.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, B');
            },
            '69': () => {
                this.registers.l.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, C');
            },
            '6A': () => {
                this.registers.l.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, D');
            },
            '6B': () => {
                this.registers.l.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, E');
            },
            '6C': () => {
                this.registers.l.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, H');
            },
            '6D': () => {
                this.registers.l.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, L');
            },
            '6E': () => {
                this.registers.l.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, (HL)');
            },
            '6F': () => {
                this.registers.l.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, A');
            },
            // LD (HL), r8
            '70': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.b.value as uint8);
                this.pc.inc();
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('LD (HL), B');
            },
            '71': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.c.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), C');
            },
            '72': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.d.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), D');
            },
            '73': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.e.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), E');
            },
            '74': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.h.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), H');
            },
            '75': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.l.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), L');
            },
            '77': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), A');
            },
            // LD A, r8
            '78': () => {
                this.registers.a.value = new uint8(this.registers.b.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B');
            },
            '79': () => {
                this.registers.a.value = new uint8(this.registers.c.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD C');
            },
            '7A': () => {
                this.registers.a.value = new uint8(this.registers.d.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D');
            },
            '7B': () => {
                this.registers.a.value = new uint8(this.registers.e.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E');
            },
            '7C': () => {
                this.registers.a.value = new uint8(this.registers.h.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H');
            },
            '7D': () => {
                this.registers.a.value = new uint8(this.registers.l.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L');
            },
            '7E': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL)');
            },
            '7F': () => {
                this.registers.a.value = new uint8(this.registers.a.value.value);
                this.cycles++;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD A');
            },
            // LD r16, nn
            '01': () => {
                this.pc.inc();
                this.registers.bc.value = this.getPC16();
                this.cycles += 3;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD BC, nn');
            },
            '11': () => {
                this.pc.inc();
                this.registers.de.value = this.getPC16();
                this.cycles += 3;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD DE, nn');
            },
            '21': () => {
                this.pc.inc();
                const val = this.getPC16();
                this.registers.hl.value = val;
                this.cycles += 3;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push(`LD HL, ${val.value.toString(16).padStart(4, '0')}`);
            },
            '31': () => {
                this.pc.inc();
                this.sp = this.getPC16();
                this.cycles += 3;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD SP, nn');
            },
            // LD (r16), A
            '02': () => {
                this.memory.w8(this.registers.bc.value as uint16, this.registers.a.value as uint8);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (BC), A');
            },
            '12': () => {
                this.memory.w8(this.registers.de.value as uint16, this.registers.a.value as uint8);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (DE), A');
            },
            // LDI (HL), A
            '22': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.registers.hl.value = new uint16(this.registers.hl.value.value + 1);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDI (HL), A');
            },
            // LDD (HL), A
            '32': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.registers.a.value as uint8);
                this.registers.hl.value = new uint16(this.registers.hl.value.value - 1);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDD (HL), A');
            },
            // LD r8, n
            '06': () => {
                this.pc.inc();
                this.registers.b.value = this.getPCByte();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD B, n');
            },
            '0E': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.registers.c.value = val;
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push(`LD C, ${val.value.toString(16).padStart(2, '0')}`);
            },
            '16': () => {
                this.pc.inc();
                this.registers.d.value = this.getPCByte();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD D, n');
            },
            '1E': () => {
                this.pc.inc();
                this.registers.e.value = this.getPCByte();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD E, n');
            },
            '26': () => {
                this.pc.inc();
                this.registers.h.value = this.getPCByte();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD H, n');
            },
            '2E': () => {
                this.pc.inc();
                this.registers.l.value = this.getPCByte();
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD L, n');
            },
            '36': () => {
                this.pc.inc();
                this.memory.w8(this.registers.hl.value as uint16, this.getPCByte());
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (HL), n');
            },
            '3E': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.registers.a.value = val;
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push(`LD A, ${val.value.toString(16).padStart(2, '0')}`);
            },
            // LD (nn), SP
            '08': () => {
                this.pc.inc();
                this.memory.w16(this.getPC16(), this.sp);
                this.cycles += 5;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD (nn), SP');
            },
            // LD A, (r16)
            '0A': () => {
                this.registers.a.value = this.memory.r8(this.registers.bc.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (BC)');
            },
            '1A': () => {
                this.registers.a.value = this.memory.r8(this.registers.de.value as uint16);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD (DE)');
            },
            // LDI A, (HL)
            '2A': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.registers.hl.value = new uint16(this.registers.hl.value.value + 1);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDI (HL)');
            },
            // LDD A, (HL)
            '3A': () => {
                this.registers.a.value = this.memory.r8(this.registers.hl.value as uint16);
                this.registers.hl.value = new uint16(this.registers.hl.value.value - 1);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDD (BC)');
            },
            // LDH (n), A
            'E0': () => {
                this.pc.inc();
                const addr = this.getPCByte();
                if (0xFF00 + addr.value <= 0xFFFF) {
                    this.memory.w8(new uint16(0xFF00 + addr.value), this.registers.a.value as uint8);
                }
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push(`LDH (0xFF00 + ${addr.value.toString(16).padStart(2, '0')}), A`);
            },
            // LDH A, (n)
            'F0': () => {
                this.pc.inc();
                const addr = this.getPCByte();
                if (0xFF00 + addr.value <= 0xFFFF) {
                    this.registers.a.value = this.memory.r8(new uint16(0xFF00 + addr.value));
                }
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push(`LDH A, (0xFF00 + ${addr.value.toString(16).padStart(2, '0')})`);
            },
            // LDH (C), A
            'E2': () => {
                this.memory.w8(new uint16(0xFF00 + this.registers.c.value.value), this.registers.a.value as uint8);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDH (C), A');
            },
            // LDH A, (C)
            'F2': () => {
                this.registers.a.value = this.memory.r8(new uint16(0xFF00 + this.registers.c.value.value));
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDH A, (C)');
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
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LDHL SP, d');
            },
            // LD SP, HL
            'F9': () => {
                this.sp = new uint16(this.registers.hl.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('LD SP, HL');
            },
            // LD (nn), A
            'EA': () => {
                this.pc.inc();
                this.memory.w8(this.getPC16(), this.registers.a.value as uint8);
                this.cycles += 4;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD (nn), A');
            },
            // LD A, (nn)
            'FA': () => {
                this.pc.inc();
                this.registers.a.value = this.memory.r8(this.getPC16());
                this.cycles += 4;
                this.pc.inc(2);
                if (this.debug) this.debugLogs.push('LD A, (nn)');
            },
            // CALL nn
            'CD': () => {
                this.pc.inc();
                const addr = this.getPC16(); // store nn to addr
                this.pc.inc(2); // move to instruction after CALL
                this.sp.dec(2); // move up the stack pointer for a new 16-bit value
                this.memory.w16(this.sp, this.pc); // store next instruction address to new stack location
                this.jump(addr.value, null, false); // execute unconditional jump to addr
                this.cycles += 6;
                if (this.debug) this.debugLogs.push('CALL nn');
            },
            // CALL NZ, nn
            'C4': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'NZ', false)) {
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles += 6;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('CALL NZ, nn');
            },
            // CALL NC, nn
            'D4': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'NC', false)) {
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles += 6;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('CALL NC, nn');
            },
            // CALL Z, nn
            'CC': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'Z', false)) {
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles += 6;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('CALL Z, nn');
            },
            // CALL C, nn
            'DC': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                const nextInst = new uint16(this.pc.value); // if jump is successful, PC will be overwritten
                if (this.jump(addr.value, 'C', false)) {
                    this.sp.dec(2);
                    this.memory.w16(this.sp, nextInst); // if successful jump, we need to push nextInst to the stack
                    this.cycles += 6;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('CALL C, nn');
            },
            // JP nn
            'C3': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                this.jump(addr.value, null, false);
                this.cycles += 4;
                if (this.debug) this.debugLogs.push('JP nn');
            },
            // JP NZ, nn
            'C2': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'NZ', false)) {
                    this.cycles += 4;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('JP NZ, nn');
            },
            // JP NC, nn
            'D2': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'NC', false)) {
                    this.cycles += 4;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('JP NC, nn');
            },
            // JP Z, nn
            'CA': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'Z', false)) {
                    this.cycles += 4;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('JP Z, nn');
            },
            // JP C, nn
            'DA': () => {
                this.pc.inc();
                const addr = this.getPC16();
                this.pc.inc(2);
                if (this.jump(addr.value, 'C', false)) {
                    this.cycles += 4;
                } else {
                    this.cycles += 3;
                }
                if (this.debug) this.debugLogs.push('JP C, nn');
            },
            // JP HL
            'E9': () => {
                this.pc = new uint16(this.registers.hl.value.value);
                this.cycles++;
                if (this.debug) this.debugLogs.push('JP HL');
            },
            // JR n
            '18': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.pc.inc();
                this.jump(val.value, null, true);
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('JR n');
            },
            // JR NZ, n
            '20': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.pc.inc();
                if (this.jump(val.value, 'NZ', true)) {
                    this.cycles += 3;
                } else {
                    this.cycles += 2;
                }
                if (this.debug) this.debugLogs.push(`JR NZ, ${val.value.toString(16).padStart(2, '0')}`);
            },
            // JR NC, n
            '30': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.pc.inc();
                if (this.jump(val.value, 'NC', true)) {
                    this.cycles += 3;
                } else {
                    this.cycles += 2;
                }
                if (this.debug) this.debugLogs.push('JR NC, n');
            },
            // JR Z, n
            '28': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.pc.inc();
                if (this.jump(val.value, 'Z', true)) {
                    this.cycles += 3;
                } else {
                    this.cycles += 2;
                }
                if (this.debug) this.debugLogs.push(`JR Z, ${val.value.toString(16).padStart(2, '0')}`);
            },
            // JR C, n
            '38': () => {
                this.pc.inc();
                const val = this.getPCByte();
                this.pc.inc();
                if (this.jump(val.value, 'C', true)) {
                    this.cycles += 3;
                } else {
                    this.cycles += 2;
                }
                if (this.debug) this.debugLogs.push('JR C, n');
            },
            // RET NZ
            'C0': () => {
                if (this.conditionMet('NZ')) {
                    this.cycles += 5;
                    this.pc = this.pop16();
                } else {
                    this.cycles += 2;
                    this.pc.inc();
                }
                if (this.debug) this.debugLogs.push('RET NZ');
            },
            // RET NC
            'D0': () => {
                if (this.conditionMet('NC')) {
                    this.cycles += 5;
                    this.pc = this.pop16();
                } else {
                    this.cycles += 2;
                    this.pc.inc();
                }
                if (this.debug) this.debugLogs.push('RET NC');
            },
            // RET Z
            'C8': () => {
                if (this.conditionMet('Z')) {
                    this.cycles += 5;
                    this.pc = this.pop16();
                } else {
                    this.cycles += 2;
                    this.pc.inc();
                }
                if (this.debug) this.debugLogs.push('RET Z');
            },
            // RET C
            'D8': () => {
                if (this.conditionMet('C')) {
                    this.cycles += 5;
                    this.pc = this.pop16();
                } else {
                    this.cycles += 2;
                    this.pc.inc();
                }
                if (this.debug) this.debugLogs.push('RET C');
            },
            // RET
            'C9': () => {
                this.cycles += 4;
                this.pc = this.pop16();
                if (this.debug) this.debugLogs.push('RET');
            },
            // RETI
            'D9': () => {
                this.ime = 1;
                this.cycles += 4;
                this.pc = this.pop16();
                if (this.debug) this.debugLogs.push('RETI');
            },
            // RST 0
            'C7': () => {
                this.rst(0x00);
                if (this.debug) this.debugLogs.push('RST 0');
            },
            // RST 10
            'D7': () => {
                this.rst(0x10);
                if (this.debug) this.debugLogs.push('RST 10');
            },
            // RST 20
            'E7': () => {
                this.rst(0x20);
                if (this.debug) this.debugLogs.push('RST 20');
            },
            // RST 30
            'F7': () => {
                this.rst(0x30);
                if (this.debug) this.debugLogs.push('RST 30');
            },
            // RST 8
            'CF': () => {
                this.rst(0x08);
                if (this.debug) this.debugLogs.push('RST 8');
            },
            // RST 18
            'DF': () => {
                this.rst(0x18);
                if (this.debug) this.debugLogs.push('RST 18');
            },
            // RST 28
            'EF': () => {
                this.rst(0x28);
                if (this.debug) this.debugLogs.push('RST 28');
            },
            // RST 38
            'FF': () => {
                this.rst(0x38);
                if (this.debug) this.debugLogs.push('RST 38');
            },
            // CB-Prefix
            'CB': () => {
                this.pc.inc();
                const op = this.getPCByte().value.toString(16).padStart(2, '0').toUpperCase();
                this.CBOps[op]();
                if (this.debug) this.debugLogs.push(`CB ${op}`);
            },
            // POP
            'C1': () => {
                this.registers.bc.value = this.pop16();
                this.pc.inc();
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('POP BC');
            },
            'D1': () => {
                this.registers.de.value = this.pop16();
                this.pc.inc();
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('POP DE');
            },
            'E1': () => {
                this.registers.hl.value = this.pop16();
                this.pc.inc();
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('POP HL');
            },
            'F1': () => {
                this.flags.value = this.pop8();
                this.registers.a.value = this.pop8();
                this.pc.inc();
                this.cycles += 3;
                if (this.debug) this.debugLogs.push('POP AF');
            },
            // PUSH
            'C5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.bc.value as uint16);
                this.pc.inc();
                this.cycles += 4;
                if (this.debug) this.debugLogs.push('PUSH BC');
            },
            'D5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.de.value as uint16);
                this.pc.inc();
                this.cycles += 4;
                if (this.debug) this.debugLogs.push('PUSH DE');
            },
            'E5': () => {
                this.sp.dec(2);
                this.memory.w16(this.sp, this.registers.hl.value as uint16);
                this.pc.inc();
                this.cycles += 4;
                if (this.debug) this.debugLogs.push('PUSH HL');
            },
            'F5': () => {
                this.sp.dec();
                this.memory.w8(this.sp, this.registers.a.value as uint8);
                this.sp.dec();
                this.memory.w8(this.sp, this.flags.value);
                this.pc.inc();
                this.cycles += 4;
                if (this.debug) this.debugLogs.push('PUSH AF');
            },
            // CCF
            '3F': () => {
                this.flags.subtraction = 0;
                this.flags.halfCarry = 0;
                this.flags.carry = (this.flags.carry) ? 0 : 1;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('CCF');
            },
            // CPL
            '2F': () => {
                this.registers.a.value = new uint8(this.registers.a.value.value ^ 0xFF);
                this.flags.subtraction = 1;
                this.flags.halfCarry = 1;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('CPL');
            },
            // DAA (idfk, ripped from cpp example found online) -- basically make hex values look like base 10 (0x9, 0xA --> 0x10, 0xB --> 0x11)
            '27': () => {
                if (!this.flags.subtraction) {
                    if (this.flags.carry || this.registers.a.value.value > 0x99) {
                        this.registers.a.value.value = (this.registers.a.value.value + 0x60) & 0xFF;
                        this.flags.carry = 1;
                    }
                    if (this.flags.halfCarry || (this.registers.a.value.value & 0xF) > 0x9) {
                        this.registers.a.value.value = (this.registers.a.value.value + 0x06) & 0xFF;
                        this.flags.halfCarry = 0;
                    }
                }
                else if (this.flags.carry && this.flags.halfCarry) {
                    this.registers.a.value.value = (this.registers.a.value.value + 0x9A) & 0xFF;
                    this.flags.halfCarry = 0;
                }
                else if (this.flags.carry) {
                    this.registers.a.value.value = (this.registers.a.value.value + 0xA0) & 0xFF;
                }
                else if (this.flags.halfCarry) {
                    this.registers.a.value.value = (this.registers.a.value.value + 0xFA) & 0xFF;
                    this.flags.halfCarry = 0;
                }
                this.flags.zero = (this.registers.a.value.value === 0) ? 1 : 0;

                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('DAA');
            },
            // DI
            'F3': () => {
                this.ime = 0;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('DI');
            },
            // EI
            'FB': () => {
                this.ime = 1;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('EI');
            },
            // HALT
            '76': () => {
                this.halt = 1;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('HALT');
            },
            // NOP
            '00': () => {
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('NOP');
            },
            // SCF
            '37': () => {
                this.flags.subtraction = 0;
                this.flags.halfCarry = 0;
                this.flags.carry = 1;
                this.pc.inc();
                this.cycles++;
                if (this.debug) this.debugLogs.push('SCF');
            },
            // STOP
            '10': () => {
                this.stop = 1;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('STOP');
            },
            // RLC A (dupe)
            '07': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC A');
            },
            // RL A (dupe)
            '17': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL A');
            },
        };
    }

    generateCBOpsMap() {
        this.CBOps = {
            // BIT
            '40': () => {
                this.testBit(0, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, B');
            },
            '41': () => {
                this.testBit(0, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, C');
            },
            '42': () => {
                this.testBit(0, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, D');
            },
            '43': () => {
                this.testBit(0, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, E');
            },
            '44': () => {
                this.testBit(0, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, H');
            },
            '45': () => {
                this.testBit(0, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, L');
            },
            '46': () => {
                this.testBit(0, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, (HL)');
            },
            '47': () => {
                this.testBit(0, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 0, A');
            },
            '48': () => {
                this.testBit(1, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, B');
            },
            '49': () => {
                this.testBit(1, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, C');
            },
            '4A': () => {
                this.testBit(1, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, D');
            },
            '4B': () => {
                this.testBit(1, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, E');
            },
            '4C': () => {
                this.testBit(1, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, H');
            },
            '4D': () => {
                this.testBit(1, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, L');
            },
            '4E': () => {
                this.testBit(1, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, (HL)');
            },
            '4F': () => {
                this.testBit(1, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 1, A');
            },
            '50': () => {
                this.testBit(2, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, B');
            },
            '51': () => {
                this.testBit(2, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, C');
            },
            '52': () => {
                this.testBit(2, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, D');
            },
            '53': () => {
                this.testBit(2, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, E');
            },
            '54': () => {
                this.testBit(2, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, H');
            },
            '55': () => {
                this.testBit(2, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, L');
            },
            '56': () => {
                this.testBit(2, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, (HL)');
            },
            '57': () => {
                this.testBit(2, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 2, A');
            },
            '58': () => {
                this.testBit(3, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, B');
            },
            '59': () => {
                this.testBit(3, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, C');
            },
            '5A': () => {
                this.testBit(3, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, D');
            },
            '5B': () => {
                this.testBit(3, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, E');
            },
            '5C': () => {
                this.testBit(3, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, H');
            },
            '5D': () => {
                this.testBit(3, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, L');
            },
            '5E': () => {
                this.testBit(3, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, (HL)');
            },
            '5F': () => {
                this.testBit(3, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 3, A');
            },
            '60': () => {
                this.testBit(4, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, B');
            },
            '61': () => {
                this.testBit(4, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, C');
            },
            '62': () => {
                this.testBit(4, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, D');
            },
            '63': () => {
                this.testBit(4, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, E');
            },
            '64': () => {
                this.testBit(4, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, H');
            },
            '65': () => {
                this.testBit(4, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, L');
            },
            '66': () => {
                this.testBit(4, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, (HL)');
            },
            '67': () => {
                this.testBit(4, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 4, A');
            },
            '68': () => {
                this.testBit(5, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, B');
            },
            '69': () => {
                this.testBit(5, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, C');
            },
            '6A': () => {
                this.testBit(5, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, D');
            },
            '6B': () => {
                this.testBit(5, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, E');
            },
            '6C': () => {
                this.testBit(5, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, H');
            },
            '6D': () => {
                this.testBit(5, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, L');
            },
            '6E': () => {
                this.testBit(5, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, (HL)');
            },
            '6F': () => {
                this.testBit(5, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 5, A');
            },
            '70': () => {
                this.testBit(6, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, B');
            },
            '71': () => {
                this.testBit(6, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, C');
            },
            '72': () => {
                this.testBit(6, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, D');
            },
            '73': () => {
                this.testBit(6, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, E');
            },
            '74': () => {
                this.testBit(6, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, H');
            },
            '75': () => {
                this.testBit(6, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, L');
            },
            '76': () => {
                this.testBit(6, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, (HL)');
            },
            '77': () => {
                this.testBit(6, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 6, A');
            },
            '78': () => {
                this.testBit(7, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, B');
            },
            '79': () => {
                this.testBit(7, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, C');
            },
            '7A': () => {
                this.testBit(7, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, D');
            },
            '7B': () => {
                this.testBit(7, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, E');
            },
            '7C': () => {
                this.testBit(7, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, H');
            },
            '7D': () => {
                this.testBit(7, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, L');
            },
            '7E': () => {
                this.testBit(7, this.memory.r8(this.registers.hl.value as uint16).value);
                this.cycles += 3;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, (HL)');
            },
            '7F': () => {
                this.testBit(7, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('BIT 7, A');
            },
            // RES
            '80': () => {
                this.registers.b.value = this.resetBit(0, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, B');
            },
            '81': () => {
                this.registers.c.value = this.resetBit(0, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, C');
            },
            '82': () => {
                this.registers.d.value = this.resetBit(0, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, D');
            },
            '83': () => {
                this.registers.e.value = this.resetBit(0, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, E');
            },
            '84': () => {
                this.registers.h.value = this.resetBit(0, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, H');
            },
            '85': () => {
                this.registers.l.value = this.resetBit(0, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, L');
            },
            '86': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(0, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, (HL)');
            },
            '87': () => {
                this.registers.a.value = this.resetBit(0, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 0, A');
            },
            '88': () => {
                this.registers.b.value = this.resetBit(1, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, B');
            },
            '89': () => {
                this.registers.c.value = this.resetBit(1, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, C');
            },
            '8A': () => {
                this.registers.d.value = this.resetBit(1, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, D');
            },
            '8B': () => {
                this.registers.e.value = this.resetBit(1, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, E');
            },
            '8C': () => {
                this.registers.h.value = this.resetBit(1, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, H');
            },
            '8D': () => {
                this.registers.l.value = this.resetBit(1, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, L');
            },
            '8E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(1, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, (HL)');
            },
            '8F': () => {
                this.registers.a.value = this.resetBit(1, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 1, A');
            },
            '90': () => {
                this.registers.b.value = this.resetBit(2, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, B');
            },
            '91': () => {
                this.registers.c.value = this.resetBit(2, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, C');
            },
            '92': () => {
                this.registers.d.value = this.resetBit(2, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, D');
            },
            '93': () => {
                this.registers.e.value = this.resetBit(2, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, E');
            },
            '94': () => {
                this.registers.h.value = this.resetBit(2, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, H');
            },
            '95': () => {
                this.registers.l.value = this.resetBit(2, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, L');
            },
            '96': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(2, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, (HL)');
            },
            '97': () => {
                this.registers.a.value = this.resetBit(2, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 2, A');
            },
            '98': () => {
                this.registers.b.value = this.resetBit(3, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, B');
            },
            '99': () => {
                this.registers.c.value = this.resetBit(3, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, C');
            },
            '9A': () => {
                this.registers.d.value = this.resetBit(3, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, D');
            },
            '9B': () => {
                this.registers.e.value = this.resetBit(3, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, E');
            },
            '9C': () => {
                this.registers.h.value = this.resetBit(3, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, H');
            },
            '9D': () => {
                this.registers.l.value = this.resetBit(3, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, L');
            },
            '9E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(3, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, (HL)');
            },
            '9F': () => {
                this.registers.a.value = this.resetBit(3, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 3, A');
            },
            'A0': () => {
                this.registers.b.value = this.resetBit(4, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, B');
            },
            'A1': () => {
                this.registers.c.value = this.resetBit(4, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, C');
            },
            'A2': () => {
                this.registers.d.value = this.resetBit(4, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, D');
            },
            'A3': () => {
                this.registers.e.value = this.resetBit(4, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, E');
            },
            'A4': () => {
                this.registers.h.value = this.resetBit(4, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, H');
            },
            'A5': () => {
                this.registers.l.value = this.resetBit(4, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, L');
            },
            'A6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(4, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, (HL)');
            },
            'A7': () => {
                this.registers.a.value = this.resetBit(4, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 4, A');
            },
            'A8': () => {
                this.registers.b.value = this.resetBit(5, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, B');
            },
            'A9': () => {
                this.registers.c.value = this.resetBit(5, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, C');
            },
            'AA': () => {
                this.registers.d.value = this.resetBit(5, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, D');
            },
            'AB': () => {
                this.registers.e.value = this.resetBit(5, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, E');
            },
            'AC': () => {
                this.registers.h.value = this.resetBit(5, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, H');
            },
            'AD': () => {
                this.registers.l.value = this.resetBit(5, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, L');
            },
            'AE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(5, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, (HL)');
            },
            'AF': () => {
                this.registers.a.value = this.resetBit(5, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 5, A');
            },
            'B0': () => {
                this.registers.b.value = this.resetBit(6, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, B');
            },
            'B1': () => {
                this.registers.c.value = this.resetBit(6, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, C');
            },
            'B2': () => {
                this.registers.d.value = this.resetBit(6, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, D');
            },
            'B3': () => {
                this.registers.e.value = this.resetBit(6, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, E');
            },
            'B4': () => {
                this.registers.h.value = this.resetBit(6, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, H');
            },
            'B5': () => {
                this.registers.l.value = this.resetBit(6, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, L');
            },
            'B6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(6, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, (HL)');
            },
            'B7': () => {
                this.registers.a.value = this.resetBit(6, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 6, A');
            },
            'B8': () => {
                this.registers.b.value = this.resetBit(7, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, B');
            },
            'B9': () => {
                this.registers.c.value = this.resetBit(7, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, C');
            },
            'BA': () => {
                this.registers.d.value = this.resetBit(7, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, D');
            },
            'BB': () => {
                this.registers.e.value = this.resetBit(7, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, E');
            },
            'BC': () => {
                this.registers.h.value = this.resetBit(7, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, H');
            },
            'BD': () => {
                this.registers.l.value = this.resetBit(7, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, L');
            },
            'BE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.resetBit(7, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, (HL)');
            },
            'BF': () => {
                this.registers.a.value = this.resetBit(7, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RES 7, A');
            },
            // SET
            'C0': () => {
                this.registers.b.value = this.setBit(0, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, B');
            },
            'C1': () => {
                this.registers.c.value = this.setBit(0, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, C');
            },
            'C2': () => {
                this.registers.d.value = this.setBit(0, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, D');
            },
            'C3': () => {
                this.registers.e.value = this.setBit(0, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, E');
            },
            'C4': () => {
                this.registers.h.value = this.setBit(0, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, H');
            },
            'C5': () => {
                this.registers.l.value = this.setBit(0, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, L');
            },
            'C6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(0, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, (HL)');
            },
            'C7': () => {
                this.registers.a.value = this.setBit(0, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 0, A');
            },
            'C8': () => {
                this.registers.b.value = this.setBit(1, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, B');
            },
            'C9': () => {
                this.registers.c.value = this.setBit(1, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, C');
            },
            'CA': () => {
                this.registers.d.value = this.setBit(1, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, D');
            },
            'CB': () => {
                this.registers.e.value = this.setBit(1, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, E');
            },
            'CC': () => {
                this.registers.h.value = this.setBit(1, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, H');
            },
            'CD': () => {
                this.registers.l.value = this.setBit(1, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, L');
            },
            'CE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(1, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, (HL)');
            },
            'CF': () => {
                this.registers.a.value = this.setBit(1, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 1, A');
            },
            'D0': () => {
                this.registers.b.value = this.setBit(2, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, B');
            },
            'D1': () => {
                this.registers.c.value = this.setBit(2, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, C');
            },
            'D2': () => {
                this.registers.d.value = this.setBit(2, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, D');
            },
            'D3': () => {
                this.registers.e.value = this.setBit(2, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, E');
            },
            'D4': () => {
                this.registers.h.value = this.setBit(2, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, H');
            },
            'D5': () => {
                this.registers.l.value = this.setBit(2, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, L');
            },
            'D6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(2, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, (HL)');
            },
            'D7': () => {
                this.registers.a.value = this.setBit(2, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 2, A');
            },
            'D8': () => {
                this.registers.b.value = this.setBit(3, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, B');
            },
            'D9': () => {
                this.registers.c.value = this.setBit(3, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, C');
            },
            'DA': () => {
                this.registers.d.value = this.setBit(3, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, D');
            },
            'DB': () => {
                this.registers.e.value = this.setBit(3, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, E');
            },
            'DC': () => {
                this.registers.h.value = this.setBit(3, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, H');
            },
            'DD': () => {
                this.registers.l.value = this.setBit(3, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, L');
            },
            'DE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(3, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, (HL)');
            },
            'DF': () => {
                this.registers.a.value = this.setBit(3, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 3, A');
            },
            'E0': () => {
                this.registers.b.value = this.setBit(4, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, B');
            },
            'E1': () => {
                this.registers.c.value = this.setBit(4, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, C');
            },
            'E2': () => {
                this.registers.d.value = this.setBit(4, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, D');
            },
            'E3': () => {
                this.registers.e.value = this.setBit(4, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, E');
            },
            'E4': () => {
                this.registers.h.value = this.setBit(4, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, H');
            },
            'E5': () => {
                this.registers.l.value = this.setBit(4, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, L');
            },
            'E6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(4, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, (HL)');
            },
            'E7': () => {
                this.registers.a.value = this.setBit(4, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 4, A');
            },
            'E8': () => {
                this.registers.b.value = this.setBit(5, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, B');
            },
            'E9': () => {
                this.registers.c.value = this.setBit(5, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, C');
            },
            'EA': () => {
                this.registers.d.value = this.setBit(5, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, D');
            },
            'EB': () => {
                this.registers.e.value = this.setBit(5, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, E');
            },
            'EC': () => {
                this.registers.h.value = this.setBit(5, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, H');
            },
            'ED': () => {
                this.registers.l.value = this.setBit(5, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, L');
            },
            'EE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(5, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, (HL)');
            },
            'EF': () => {
                this.registers.a.value = this.setBit(5, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 5, A');
            },
            'F0': () => {
                this.registers.b.value = this.setBit(6, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, B');
            },
            'F1': () => {
                this.registers.c.value = this.setBit(6, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, C');
            },
            'F2': () => {
                this.registers.d.value = this.setBit(6, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, D');
            },
            'F3': () => {
                this.registers.e.value = this.setBit(6, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, E');
            },
            'F4': () => {
                this.registers.h.value = this.setBit(6, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, H');
            },
            'F5': () => {
                this.registers.l.value = this.setBit(6, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, L');
            },
            'F6': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(6, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, (HL)');
            },
            'F7': () => {
                this.registers.a.value = this.setBit(6, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 6, A');
            },
            'F8': () => {
                this.registers.b.value = this.setBit(7, this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, B');
            },
            'F9': () => {
                this.registers.c.value = this.setBit(7, this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, C');
            },
            'FA': () => {
                this.registers.d.value = this.setBit(7, this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, D');
            },
            'FB': () => {
                this.registers.e.value = this.setBit(7, this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, E');
            },
            'FC': () => {
                this.registers.h.value = this.setBit(7, this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, H');
            },
            'FD': () => {
                this.registers.l.value = this.setBit(7, this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, L');
            },
            'FE': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.setBit(7, this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, (HL)');
            },
            'FF': () => {
                this.registers.a.value = this.setBit(7, this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SET 7, A');
            },
            // SWAP
            '30': () => {
                this.registers.b.value = this.swap(this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP B');
            },
            '31': () => {
                this.registers.c.value = this.swap(this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP C');
            },
            '32': () => {
                this.registers.d.value = this.swap(this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP D');
            },
            '33': () => {
                this.registers.e.value = this.swap(this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP E');
            },
            '34': () => {
                this.registers.h.value = this.swap(this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP H');
            },
            '35': () => {
                this.registers.l.value = this.swap(this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP L');
            },
            '36': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.swap(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP (HL)');
            },
            '37': () => {
                this.registers.a.value = this.swap(this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SWAP A');
            },
            // RL
            '10': () => {
                this.registers.b.value = this.rotateLeft(this.registers.b.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL B');
            },
            '11': () => {
                this.registers.c.value = this.rotateLeft(this.registers.c.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL C');
            },
            '12': () => {
                this.registers.d.value = this.rotateLeft(this.registers.d.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL D');
            },
            '13': () => {
                this.registers.e.value = this.rotateLeft(this.registers.e.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL E');
            },
            '14': () => {
                this.registers.h.value = this.rotateLeft(this.registers.h.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL H');
            },
            '15': () => {
                this.registers.l.value = this.rotateLeft(this.registers.l.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL L');
            },
            '16': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateLeft(this.memory.r8(this.registers.hl.value as uint16).value, true));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL (HL)');
            },
            '17': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RL A');
            },
            // RLC
            '00': () => {
                this.registers.b.value = this.rotateLeft(this.registers.b.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC B');
            },
            '01': () => {
                this.registers.c.value = this.rotateLeft(this.registers.c.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC C');
            },
            '02': () => {
                this.registers.d.value = this.rotateLeft(this.registers.d.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC D');
            },
            '03': () => {
                this.registers.e.value = this.rotateLeft(this.registers.e.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC E');
            },
            '04': () => {
                this.registers.h.value = this.rotateLeft(this.registers.h.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC H');
            },
            '05': () => {
                this.registers.l.value = this.rotateLeft(this.registers.l.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC L');
            },
            '06': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateLeft(this.memory.r8(this.registers.hl.value as uint16).value, false));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC (HL)');
            },
            '07': () => {
                this.registers.a.value = this.rotateLeft(this.registers.a.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RLC A');
            },
            // RR
            '18': () => {
                this.registers.b.value = this.rotateRight(this.registers.b.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR B');
            },
            '19': () => {
                this.registers.c.value = this.rotateRight(this.registers.c.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR C');
            },
            '1A': () => {
                this.registers.d.value = this.rotateRight(this.registers.d.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR D');
            },
            '1B': () => {
                this.registers.e.value = this.rotateRight(this.registers.e.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR E');
            },
            '1C': () => {
                this.registers.h.value = this.rotateRight(this.registers.h.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR H');
            },
            '1D': () => {
                this.registers.l.value = this.rotateRight(this.registers.l.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR L');
            },
            '1E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateRight(this.memory.r8(this.registers.hl.value as uint16).value, true));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR (HL)');
            },
            '1F': () => {
                this.registers.a.value = this.rotateRight(this.registers.a.value.value, true);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RR A');
            },
            // RRC
            '08': () => {
                this.registers.b.value = this.rotateRight(this.registers.b.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC B');
            },
            '09': () => {
                this.registers.c.value = this.rotateRight(this.registers.c.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC C');
            },
            '0A': () => {
                this.registers.d.value = this.rotateRight(this.registers.d.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC D');
            },
            '0B': () => {
                this.registers.e.value = this.rotateRight(this.registers.e.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC E');
            },
            '0C': () => {
                this.registers.h.value = this.rotateRight(this.registers.h.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC H');
            },
            '0D': () => {
                this.registers.l.value = this.rotateRight(this.registers.l.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC L');
            },
            '0E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.rotateRight(this.memory.r8(this.registers.hl.value as uint16).value, false));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC (HL)');
            },
            '0F': () => {
                this.registers.a.value = this.rotateRight(this.registers.a.value.value, false);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('RRC A');
            },
            // SLA
            '20': () => {
                this.registers.b.value = this.shiftLeftA(this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA B');
            },
            '21': () => {
                this.registers.c.value = this.shiftLeftA(this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA C');
            },
            '22': () => {
                this.registers.d.value = this.shiftLeftA(this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA D');
            },
            '23': () => {
                this.registers.e.value = this.shiftLeftA(this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA E');
            },
            '24': () => {
                this.registers.h.value = this.shiftLeftA(this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA H');
            },
            '25': () => {
                this.registers.l.value = this.shiftLeftA(this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA L');
            },
            '26': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftLeftA(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA (HL)');
            },
            '27': () => {
                this.registers.a.value = this.shiftLeftA(this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SLA A');
            },
            // SRA
            '28': () => {
                this.registers.b.value = this.shiftRightA(this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA B');
            },
            '29': () => {
                this.registers.c.value = this.shiftRightA(this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA C');
            },
            '2A': () => {
                this.registers.d.value = this.shiftRightA(this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA D');
            },
            '2B': () => {
                this.registers.e.value = this.shiftRightA(this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA E');
            },
            '2C': () => {
                this.registers.h.value = this.shiftRightA(this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA H');
            },
            '2D': () => {
                this.registers.l.value = this.shiftRightA(this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA L');
            },
            '2E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftRightA(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA (HL)');
            },
            '2F': () => {
                this.registers.a.value = this.shiftRightA(this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRA A');
            },
            // SRL
            '38': () => {
                this.registers.b.value = this.shiftRightL(this.registers.b.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL B');
            },
            '39': () => {
                this.registers.c.value = this.shiftRightL(this.registers.c.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL C');
            },
            '3A': () => {
                this.registers.d.value = this.shiftRightL(this.registers.d.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL D');
            },
            '3B': () => {
                this.registers.e.value = this.shiftRightL(this.registers.e.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL E');
            },
            '3C': () => {
                this.registers.h.value = this.shiftRightL(this.registers.h.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL H');
            },
            '3D': () => {
                this.registers.l.value = this.shiftRightL(this.registers.l.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL L');
            },
            '3E': () => {
                this.memory.w8(this.registers.hl.value as uint16, this.shiftRightL(this.memory.r8(this.registers.hl.value as uint16).value));
                this.cycles += 4;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL (HL)');
            },
            '3F': () => {
                this.registers.a.value = this.shiftRightL(this.registers.a.value.value);
                this.cycles += 2;
                this.pc.inc();
                if (this.debug) this.debugLogs.push('SRL A');
            },
        };
    }
}