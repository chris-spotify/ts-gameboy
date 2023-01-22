import { Gameboy } from "./Gameboy.js";
import { uint16 } from "./uint16.js";
import { uint8 } from "./uint8.js";

export class GPU {
    parent: Gameboy;
    screen: ImageData;
    context: CanvasRenderingContext2D;
    mode: number; // OAM Read is first step in GPU clock cycle
    clock: number;
    line: number;
    raster: number;
    LCDOn: number; // 0 or 1
    spritesOn: number; // 0 or 1
    spritesLarge: number; // 0 or 1 (0 = 8x8, 1 = 8x16)
    backgroundOn: number; // 0 or 1
    backgroundMap: number; // 0 or 1
    backgroundTileset: number; // 0 or 1
    windowOn: number; // 0 or 1
    windowTileset: number; // 0 or 1
    palette: any;
    screenX: number;
    screenY: number;
    tileset: Array<Array<Array<number>>> = new Array(512).fill(new Array(8).fill(new Array(8).fill(0)));
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

    constructor(_parent: Gameboy){
        this.parent = _parent;
        this.reset();
    }

    reset(){
        this.context = this.parent.Screen.getContext('2d');
        this.screen = this.context.createImageData(160,144);
        this.screen.data.forEach((_,i,a) => a[i] = 255); // white screen
        this.context.putImageData(this.screen, 0, 0); // push to canvas
        this.mode = 2;
        this.clock = 0;
        this.line = 0;
        this.raster = 0;
        this.tileset = new Array(512).fill(new Array(8).fill(new Array(8).fill(0)));
        this.LCDOn = 1;
        this.spritesOn = 1;
        this.spritesLarge = 0;
        this.backgroundOn = 1;
        this.backgroundMap = 0;
        this.backgroundTileset = 0;
        this.windowOn = 0;
        this.windowTileset = 0;
        this.screenX = 0;
        this.screenY = 0;
        this.palette = {
            background: [255, 192, 96, 0],
            object0: [255, 192, 96, 0],
            object1: [255, 192, 96, 0],
        };
        // reset sprite object data
        for (let i=0;i<40;i++) this.spriteData[i] = { y: -16, x: -8, tile: 0, palette: 0, flipX: false, flipY: false, priority: 0, index: i };
    }

    draw(instructionCycles: number){
        this.clock += instructionCycles; // add cycles since last instruction to GPU clock
        switch(this.mode){
            case 0: // hblank
                if (this.clock >= 51){
                    this.clock = 0; // restart GPU clock cycle
                    this.line++; // inc line number

                    if (this.line === 143){ // last line, go to vblank and draw to canvas
                        this.mode = 1;
                        this.context.putImageData(this.screen, 0, 0);
                        this.parent.Memory.if = new uint8(this.parent.Memory.if.value | 1);
                    } else { // otherwise restart cycle with mode 2
                        this.mode = 2;
                    }
                }
                break;
            case 1: // vblank
                if (this.clock >= 114){ // there are 10 vblank lines before restarting the render
                    this.clock = 0; // restart GPU clock cycle
                    this.line++; // inc line number

                    if (this.line > 153){ // restart render
                        this.mode = 2; // first step of the cycle is OAM Read
                        this.line = 0; // back to top
                    }
                }
                break;
            case 2: // OAM Read
                if (this.clock >= 20){
                    this.clock = 0; // restart GPU clock cycle
                    this.mode = 3;  // jump to VRAM Read
                }
                break;
            case 3: // VRAM Read
                if (this.clock >= 43){
                    this.clock = 0; // restart GPU clock cycle
                    this.mode = 0; // jump to hblank (end of current scanline)
                    this.renderScanline(); // render scanline to screen buffer
                }
                break;
        };
    }

    renderScanline(){
        const rowPixels = []; // buffer for storing background data, makes sprite drawing easier

        // draw background
        if (this.backgroundOn){
            let map = this.backgroundMap ? 0x9C00 : 0x9800; // which map offset
            map += ((this.line + this.screenY) & 255) >> 3; // which line of tiles
            let line = this.screenX >> 3; // which tile to start with in line
            let y = (this.line + this.screenY) & 7; // which line of pixels
            let x = this.screenX & 7; // where in line
            let screenDataOffset = this.line*160*4; // 4 values per pixel (RGBA)
            let tile = this.parent.Memory.r8(new uint16(map + line)).value; // tile index from background map
            if (this.backgroundTileset === 1 && tile < 128) tile+=256; // signed tile index to real tile index

            for (let i=0;i<160;i++){
                const color = this.palette.background[this.tileset[tile][y][x]]; // only allows single value for r, g, and b, consider expanding to array of separate rgb values in future
                this.screen.data[screenDataOffset] = color;
                this.screen.data[screenDataOffset+1] = color;
                this.screen.data[screenDataOffset+2] = color;
                this.screen.data[screenDataOffset+3] = 255; // alpha always 255
                screenDataOffset+=4;

                rowPixels[i] = this.tileset[tile][y][x];

                x++;
                if (x === 8){ // move to new tile
                    x = 0;
                    line = (line + 1) & 31;
                    tile = this.parent.Memory.r8(new uint16(map + line)).value;
                    if (this.backgroundTileset === 1 && tile < 128) tile+=256; // signed tile index to real tile index
                }
            }
        }

        // draw sprites
        if (this.spritesOn){
            for (let i=0;i<40;i++){
                const sprite = this.spriteData[i];

                if (sprite.y <= this.line && (sprite.y + 8) > this.line){
                    const pal = sprite.palette ? this.palette.object0 : this.palette.object1;
                    let screenDataOffset = (this.line * 160 + sprite.x) * 4;
                    let spriteRow;
                    if (sprite.flipY){
                        spriteRow = this.tileset[sprite.tile][7 - (this.line - sprite.y)];
                    } else {
                        spriteRow = this.tileset[sprite.tile][this.line - sprite.y];
                    }

                    for (let x=0;x<8;x++){
                        if ((sprite.x + x) >= 0 && (sprite.x + x) < 160 && spriteRow[x] && (sprite.priority || !rowPixels[sprite.x + x])){
                            const color = pal[spriteRow[sprite.flipX ? (7-x) : x]];
                            this.screen.data[screenDataOffset] = color;
                            this.screen.data[screenDataOffset+1] = color;
                            this.screen.data[screenDataOffset+2] = color;
                            this.screen.data[screenDataOffset+3] = 255; // alpha always 255
                            screenDataOffset+=4;
                        }
                    }
                }
            }
        }
    }

    updateTile(addr: uint16, m: uint8[]){
        const base = (addr.value & 1) ? addr.value - 1 : addr.value;
        const tile = (base >> 4) & 511;
        const y = (base >> 1) & 7;

        for (let x=0;x<8;x++){
            const sx = 1 << (7-x);
            this.tileset[tile][y][x] = ((m[base].value & sx) ? 1 : 0) + ((m[base+1].value & sx) ? 2 : 0);
        }
    }

    updateSpriteData(addr: uint16, val: uint8){
        const index = val.value >> 2;
        if (index < 40){
            switch (addr.value & 3){
                case 0: // Y
                    this.spriteData[index].y = val.value-16;
                    break;
                case 1: // X
                    this.spriteData[index].x = val.value-8;
                    break;
                case 2: // tile
                    this.spriteData[index].tile = val.value;
                    break;
                case 3: // options
                    this.spriteData[index].palette = (val.value & 0x10) ? 1 : 0;
                    this.spriteData[index].flipX = (val.value & 0x20) ? true : false;
                    this.spriteData[index].flipY = (val.value & 0x40) ? true : false;
                    this.spriteData[index].priority = (val.value & 0x80) ? 1 : 0;
                    break;
            };
        }
    }
}