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
        [0xFF00, 0xFF7F], // mmio
        [0xFF80, 0xFFFF], // zram
    ];

    if: uint8;
    ie: uint8;

    bank0: Bank = { m: [], r: this.ranges[0], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    bank1: Bank = { m: [], r: this.ranges[1], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    vram: Bank = { m: [], r: this.ranges[2], r8: this.read8, r16: this.read16, w8: this.vramWrite8, w16: this.write16 };
    eram: Bank = { m: [], r: this.ranges[3], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    wram: Bank = { m: [], r: this.ranges[4], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };
    mmio: Bank = { m: [], r: this.ranges[5], r8: this.mmioRead8, r16: this.read16, w8: this.mmioWrite8, w16: this.write16 };
    zram: Bank = { m: [], r: this.ranges[6], r8: this.read8, r16: this.read16, w8: this.write8, w16: this.write16 };

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
        this.ie = new uint8(0);
        this.if = new uint8(0);
    }

    getSource(addr: uint16){
        for (const bank of this.banks) {
            if (addr.value >= bank.r[0] && addr.value <= bank.r[1]) return bank;
        }
    }

    mmioRead8(addr: uint16, source: uint8[]){
        if (addr.value === 0x0F) return this.if; // interrupt flags
        if (addr.value >= 0x40 && addr.value <= 0x45){
            switch(addr.value-0x40){
                case 0: // GPU flags
                return new uint8((this.parent.GPU.LCDOn?0x80:0)|
                    (this.parent.GPU.windowTileset?0x40:0)|
                    (this.parent.GPU.windowOn?0x20:0)|
                    ((this.parent.GPU.backgroundTileset === 1)?0x10:0)|
                    ((this.parent.GPU.backgroundMap)?0x08:0)|
                    (this.parent.GPU.spritesLarge?0x04:0)|
                    (this.parent.GPU.spritesOn?0x02:0)|
                    (this.parent.GPU.backgroundOn?0x01:0));
                case 1: // TODO: figure out what this is???
                    return new uint8((this.parent.GPU.line === this.parent.GPU.raster?4:0)|this.parent.GPU.mode);
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

    mmioWrite8(addr: uint16, source: uint8[], val: uint8){
        if (addr.value === 0x0F) return this.if = val;
        if (addr.value >= 0x40 && addr.value <= 0x49){
            switch(addr.value - 0x40){
                case 0: // GPU flags
                    this.parent.GPU.LCDOn = (val.value&0x80)?1:0;
                    this.parent.GPU.windowTileset = (val.value&0x40)?1:0;
                    this.parent.GPU.windowOn = (val.value&0x20)?1:0;
                    this.parent.GPU.backgroundTileset = (val.value&0x10)?1:0;
                    this.parent.GPU.backgroundMap = (val.value&0x08)?1:0;
                    this.parent.GPU.spritesLarge = (val.value&0x04)?1:0;
                    this.parent.GPU.spritesOn = (val.value&0x02)?1:0;
                    this.parent.GPU.backgroundOn = (val.value&0x01)?1:0;
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
                case 6: // TODO: OAM DMA???

                    break;
                case 7: // background palette
                    for (let i=0;i<4;i++){
                        switch((val.value >> (i*2))&3){
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
                    for (let i=0;i<4;i++){
                        switch((val.value >> (i*2))&3){
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
                for (let i=0;i<4;i++){
                        switch((val.value >> (i*2))&3){
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

    zramRead8(addr: uint16, source: uint8[]){
        if (addr.value === 0x7F) return this.ie; // interrupts enabled
        return this.read8(addr, source);
    }

    zramWrite8(addr: uint16, source: uint8[], val: uint8){
        if (addr.value === 0x7F) return this.ie = val;
        return this.write8(addr, source, val);
    }

    vramWrite8(addr: uint16, source: uint8[], val: uint8){
        this.write8(addr, source, val);
        this.parent.GPU.updateTile(addr, source);
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

    w16(addr: uint16, val: uint16){
        const source = this.getSource(addr);
        if (!source) return; // unaddressed memory
        return source.w16(new uint16(addr.value - source.r[0]), source.m, val);
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