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
        [0x8000, 0x9FFF], // vram
        [0xA000, 0xBFFF], // eram (swappable)
        [0xC000, 0xDFFF], // wram
        [0xFE00, 0xFE9F], // oam
        [0xFF00, 0xFF7F], // mmio
        [0xFF80, 0xFFFF], // zram
    ];

    inBios = true;
    // ripped from jsGB
    bios = [
        0x31, 0xFE, 0xFF, 0xAF, 0x21, 0xFF, 0x9F, 0x32, 0xCB, 0x7C, 0x20, 0xFB, 0x21, 0x26, 0xFF, 0x0E,
        0x11, 0x3E, 0x80, 0x32, 0xE2, 0x0C, 0x3E, 0xF3, 0xE2, 0x32, 0x3E, 0x77, 0x77, 0x3E, 0xFC, 0xE0,
        0x47, 0x11, 0x04, 0x01, 0x21, 0x10, 0x80, 0x1A, 0xCD, 0x95, 0x00, 0xCD, 0x96, 0x00, 0x13, 0x7B,
        0xFE, 0x34, 0x20, 0xF3, 0x11, 0xD8, 0x00, 0x06, 0x08, 0x1A, 0x13, 0x22, 0x23, 0x05, 0x20, 0xF9,
        0x3E, 0x19, 0xEA, 0x10, 0x99, 0x21, 0x2F, 0x99, 0x0E, 0x0C, 0x3D, 0x28, 0x08, 0x32, 0x0D, 0x20,
        0xF9, 0x2E, 0x0F, 0x18, 0xF3, 0x67, 0x3E, 0x64, 0x57, 0xE0, 0x42, 0x3E, 0x91, 0xE0, 0x40, 0x04,
        0x1E, 0x02, 0x0E, 0x0C, 0xF0, 0x44, 0xFE, 0x90, 0x20, 0xFA, 0x0D, 0x20, 0xF7, 0x1D, 0x20, 0xF2,
        0x0E, 0x13, 0x24, 0x7C, 0x1E, 0x83, 0xFE, 0x62, 0x28, 0x06, 0x1E, 0xC1, 0xFE, 0x64, 0x20, 0x06,
        0x7B, 0xE2, 0x0C, 0x3E, 0x87, 0xE2, 0xF0, 0x42, 0x90, 0xE0, 0x42, 0x15, 0x20, 0xD2, 0x05, 0x20,
        0x4F, 0x16, 0x20, 0x18, 0xCB, 0x4F, 0x06, 0x04, 0xC5, 0xCB, 0x11, 0x17, 0xC1, 0xCB, 0x11, 0x17,
        0x05, 0x20, 0xF5, 0x22, 0x23, 0x22, 0x23, 0xC9, 0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B,
        0x03, 0x73, 0x00, 0x83, 0x00, 0x0C, 0x00, 0x0D, 0x00, 0x08, 0x11, 0x1F, 0x88, 0x89, 0x00, 0x0E,
        0xDC, 0xCC, 0x6E, 0xE6, 0xDD, 0xDD, 0xD9, 0x99, 0xBB, 0xBB, 0x67, 0x63, 0x6E, 0x0E, 0xEC, 0xCC,
        0xDD, 0xDC, 0x99, 0x9F, 0xBB, 0xB9, 0x33, 0x3E, 0x3c, 0x42, 0xB9, 0xA5, 0xB9, 0xA5, 0x42, 0x4C,
        0x21, 0x04, 0x01, 0x11, 0xA8, 0x00, 0x1A, 0x13, 0xBE, 0x20, 0xFE, 0x23, 0x7D, 0xFE, 0x34, 0x20,
        0xF5, 0x06, 0x19, 0x78, 0x86, 0x23, 0x05, 0x20, 0xFB, 0x86, 0x20, 0xFE, 0x3E, 0x01, 0xE0, 0x50
    ];

    spriteData: Array<{
        y: number;
        x: number;
        tile: number;
        palette: number;
        flipX: boolean;
        flipY: boolean;
        priority: number;
        index: number;
    }> = new Array(40);

    if: uint8;
    ie: uint8;

    bank0: Bank = { m: [], r: this.ranges[0], r8: this.bank0Read8.bind(this), r16: this.bank0Read16.bind(this), w8: this.write8, w16: this.write16 };
    bank1: Bank = { m: [], r: this.ranges[1], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    vram: Bank = { m: [], r: this.ranges[2], r8: this.read8, r16: this.read16, w8: this.vramWrite8.bind(this), w16: this.vramWrite16.bind(this) };
    eram: Bank = { m: [], r: this.ranges[3], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    wram: Bank = { m: [], r: this.ranges[4], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    oam: Bank = { m: [], r: this.ranges[5], r8: this.oamRead8.bind(this), r16: this.read16, w8: this.oamWrite8.bind(this), w16: this.write16 };
    mmio: Bank = { m: [], r: this.ranges[6], r8: this.mmioRead8.bind(this), r16: this.read16, w8: this.mmioWrite8.bind(this), w16: this.write16 };
    zram: Bank = { m: [], r: this.ranges[7], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };

    banks = [this.bank0, this.bank1, this.vram, this.eram, this.wram, this.oam, this.mmio, this.zram];

    constructor(_parent: Gameboy) {
        this.parent = _parent;
        this.reset();
    }

    reset() {
        // clear banks back to zeroes
        for (const bank of this.banks) {
            bank.m = new Array(bank.r[1] - bank.r[0] + 1).fill(new uint8(0)) as uint8[];
        }
        // set interrupt enabled/flags
        this.ie = new uint8(0);
        this.if = new uint8(0);
    }

    getSource(addr: uint16) {
        for (const bank of this.banks) {
            if (addr.value >= bank.r[0] && addr.value <= bank.r[1]) return bank;
        }
    }

    bank0Read8(addr: uint16, source: uint8[]) {
        if (this.inBios) {
            if (addr.value < 0x100) {
                return new uint8(this.bios[addr.value]);
            } else if (addr.value === 0x100) {
                console.log('LEAVING BIOS...');
                this.inBios = false;
            }
        }

        return this.read8(addr, source);
    }

    bank0Read16(addr: uint16, source: uint8[]) {
        if (this.inBios) {
            if (addr.value < 0x100) {
                return new uint16(this.bios[addr.value] + (this.bios[addr.value + 1] << 8));
            } else if (addr.value === 0x100) {
                this.inBios = false;
            }
        }

        return this.read16(addr, source);
    }

    oamRead8(addr: uint16, source: uint8[]) {
        return this.read8(addr, source);
    }

    oamWrite8(addr: uint16, source: uint8[], val: uint8) {
        this.parent.GPU.updateSpriteData(addr, val);
        return this.write8(addr, source, val);
    }

    mmioRead8(addr: uint16, source: uint8[]) {
        if (addr.value === 0x0F) return this.if; // interrupt flags
        if (addr.value >= 0x04 && addr.value <= 0x07) {
            // timer updates
            switch (addr.value) {
                case 0x04:
                    this.parent.Timer.div;
                    break;
                case 0x05:
                    this.parent.Timer.tima;
                    break;
                case 0x06:
                    this.parent.Timer.tma;
                    break;
                case 0x07:
                    this.parent.Timer.tac;
                    break;
            };
        }
        if (addr.value >= 0x40 && addr.value <= 0x45) {
            switch (addr.value - 0x40) {
                case 0: // GPU flags
                    return new uint8((this.parent.GPU.LCDOn ? 0x80 : 0) |
                        (this.parent.GPU.windowTileset ? 0x40 : 0) |
                        (this.parent.GPU.windowOn ? 0x20 : 0) |
                        ((this.parent.GPU.backgroundTileset === 1) ? 0x10 : 0) |
                        ((this.parent.GPU.backgroundMap) ? 0x08 : 0) |
                        (this.parent.GPU.spritesLarge ? 0x04 : 0) |
                        (this.parent.GPU.spritesOn ? 0x02 : 0) |
                        (this.parent.GPU.backgroundOn ? 0x01 : 0));
                case 1: // TODO: figure out what this is???
                    return new uint8((this.parent.GPU.line === this.parent.GPU.raster ? 4 : 0) | this.parent.GPU.mode);
                case 2: // screen Y
                    return new uint8(this.parent.GPU.screenY);
                case 3: // screen X
                    return new uint8(this.parent.GPU.screenX);
                case 4: // current scanline
                    return new uint8(this.parent.GPU.line);
                case 5: // raster
                    return new uint8(this.parent.GPU.raster);
            };
        }
        return this.read8(addr, source);
    }

    mmioWrite8(addr: uint16, source: uint8[], val: uint8) {
        if (addr.value === 0x0F) return this.if = val;
        if (addr.value >= 0x04 && addr.value <= 0x07) {
            // timer updates
            switch (addr.value) {
                case 0x04:
                    this.parent.Timer.div.value = 0;
                    break;
                case 0x05:
                    this.parent.Timer.tima = val;
                    break;
                case 0x06:
                    this.parent.Timer.tma = val;
                    break;
                case 0x07:
                    this.parent.Timer.tac = new uint8(val.value & 7);
                    break;
            };
        }
        if (addr.value >= 0x40 && addr.value <= 0x49) {
            switch (addr.value - 0x40) {
                case 0: // GPU flags
                    this.parent.GPU.LCDOn = (val.value & 0x80) ? 1 : 0;
                    this.parent.GPU.windowTileset = (val.value & 0x40) ? 1 : 0;
                    this.parent.GPU.windowOn = (val.value & 0x20) ? 1 : 0;
                    this.parent.GPU.backgroundTileset = (val.value & 0x10) ? 1 : 0;
                    this.parent.GPU.backgroundMap = (val.value & 0x08) ? 1 : 0;
                    this.parent.GPU.spritesLarge = (val.value & 0x04) ? 1 : 0;
                    this.parent.GPU.spritesOn = (val.value & 0x02) ? 1 : 0;
                    this.parent.GPU.backgroundOn = (val.value & 0x01) ? 1 : 0;
                    break;
                case 2: // screen Y
                    this.parent.GPU.screenY = val.value;
                    break;
                case 3: // screen X
                    this.parent.GPU.screenX = val.value;
                    break;
                case 5: // TODO: raster???
                    this.parent.GPU.raster = val.value;
                    break;
                case 6: // OAM DMA
                    for (let i = 0; i < 160; i++) {
                        const v = this.r8(new uint16((val.value << 8) + i));
                        this.oam.m[i] = v;
                        this.parent.GPU.updateSpriteData(new uint16(i), v);
                    }
                    break;
                case 7: // background palette
                    for (let i = 0; i < 4; i++) {
                        switch ((val.value >> (i * 2)) & 3) {
                            case 0:
                                this.parent.GPU.palette.background[i] = 255;
                                break;
                            case 1:
                                this.parent.GPU.palette.background[i] = 192;
                                break;
                            case 2:
                                this.parent.GPU.palette.background[i] = 96;
                                break;
                            case 3:
                                this.parent.GPU.palette.background[i] = 0;
                                break;
                        };
                    }
                    break;
                case 8: // object0 palette
                    for (let i = 0; i < 4; i++) {
                        switch ((val.value >> (i * 2)) & 3) {
                            case 0:
                                this.parent.GPU.palette.object0[i] = 255;
                                break;
                            case 1:
                                this.parent.GPU.palette.object0[i] = 192;
                                break;
                            case 2:
                                this.parent.GPU.palette.object0[i] = 96;
                                break;
                            case 3:
                                this.parent.GPU.palette.object0[i] = 0;
                                break;
                        };
                    }
                    break;
                case 9: // object1 palette
                    for (let i = 0; i < 4; i++) {
                        switch ((val.value >> (i * 2)) & 3) {
                            case 0:
                                this.parent.GPU.palette.object1[i] = 255;
                                break;
                            case 1:
                                this.parent.GPU.palette.object1[i] = 192;
                                break;
                            case 2:
                                this.parent.GPU.palette.object1[i] = 96;
                                break;
                            case 3:
                                this.parent.GPU.palette.object1[i] = 0;
                                break;
                        };
                    }
                    break;
            }
        }
        return this.write8(addr, source, val);
    }

    zramRead8(addr: uint16, source: uint8[]) {
        if (addr.value === 0x7F) return this.ie; // interrupts enabled
        return this.read8(addr, source);
    }

    zramWrite8(addr: uint16, source: uint8[], val: uint8) {
        if (addr.value === 0x7F) return this.ie = val;
        return this.write8(addr, source, val);
    }

    vramWrite8(addr: uint16, source: uint8[], val: uint8) {
        this.write8(addr, source, val);
        this.parent.GPU.updateTile(addr, source);
    }

    vramWrite16(addr: uint16, source: uint8[], val: uint16) {
        this.write16(addr, source, val);
        this.parent.GPU.updateTile(addr, source);
        this.parent.GPU.updateTile(new uint16(addr.value + 1), source); // update addr+1 in case we wrote two different tiles
    }

    r8(addr: uint16) {
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.r8(new uint16(addr.value - source.r[0]), source.m);
    }

    r16(addr: uint16) {
        const source = this.getSource(addr);
        if (!source) return; //unaddressed memory
        return source.r16(new uint16(addr.value - source.r[0]), source.m);
    }

    w8(addr: uint16, val: uint8) {
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.w8(new uint16(addr.value - source.r[0]), source.m, val);
    }

    w16(addr: uint16, val: uint16) {
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.w16(new uint16(addr.value - source.r[0]), source.m, val);
    }

    read8(addr: uint16, source: uint8[]) {
        return new uint8(source[addr.value].value);
    }

    read16(addr: uint16, source: uint8[]) {
        return new uint16(source[addr.value].value + (source[addr.value + 1].value << 8));
    }

    write8(addr: uint16, source: uint8[], value: uint8) {
        source[addr.value] = value;
    }

    write16(addr: uint16, source: uint8[], value: uint16) {
        source[addr.value] = new uint8(value.value & 0xFF);
        source[addr.value + 1] = new uint8(value.value >> 8);
    }
}