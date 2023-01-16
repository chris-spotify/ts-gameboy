import { uint8 } from "./uint8.js";
import { uint16 } from "./uint16.js";
import { Gameboy } from "./Gameboy.js";

type Bank = {
    m: uint8[]; // memory
    r: number[]; // range [number, number]
    r8: (addr: uint16, src: uint8[]) => uint8; // override read/write functions for VRAM and other special cases
    r16: (addr: uint16, src: uint8[]) => uint16;
    w8: (addr: uint16, src: uint8[], val: uint8) => void;
    w16: (addr: uint16, src: uint8[], val: uint16) => void;
};

export class Memory {
    parent: Gameboy;

    ranges = [
        [0x0000, 0x3FFF], // bank0
        [0x4000, 0x7FFF], // bank1 (swappable)
        [0xA000, 0xBFFF], // eram (swappable)
        [0xC000, 0xDFFF], // wram
        [0xFF80, 0xFFFF], // zram
    ];

    bank0: Bank = { m: [], r: this.ranges[0], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    bank1: Bank = { m: [], r: this.ranges[1], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    eram: Bank = { m: [], r: this.ranges[2], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    wram: Bank = { m: [], r: this.ranges[3], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    zram: Bank = { m: [], r: this.ranges[4], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };

    banks = [this.bank0, this.bank1, this.eram, this.wram, this.zram];

    constructor(_parent: Gameboy){
        this.parent = _parent;
        this.reset();
    }

    reset(){
        // clear banks back to zeroes
        for (const bank of this.banks) {
            bank.m = new Array(bank.r[1] - bank.r[0] + 1).fill(new uint8(0)) as uint8[];   
        }
    }

    getSource(addr: uint16){
        for (const bank of this.banks) {
            if (addr.value >= bank.r[0] && addr.value <= bank.r[1]) return bank;
        }
    }

    r8(addr: uint16){
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.r8(new uint16(addr.value - source.r[0]), source.m);
    }

    r16(addr: uint16){
        const source = this.getSource(addr);
        if (!source) return; //unaddressed memory
        return source.r16(new uint16(addr.value - source.r[0]), source.m);
    }

    w8(addr: uint16, val: uint8){
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.w8(new uint16(addr.value - source.r[0]), source.m, val);
    }

    read8(addr: uint16, source: uint8[]){
        return new uint8(source[addr.value].value);
    }

    read16(addr: uint16, source: uint8[]){
        return new uint16(source[addr.value].value + (source[addr.value + 1].value << 8));
    }

    write8(addr: uint16, source: uint8[], value: uint8){
        source[addr.value] = value;
    }

    write16(addr: uint16, source: uint8[], value: uint16){
        source[addr.value] = new uint8(value.value & 0xFF);
        source[addr.value + 1] = new uint8(value.value >> 8);
    }
}