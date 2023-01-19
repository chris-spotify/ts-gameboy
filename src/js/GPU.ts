import { Gameboy } from "./Gameboy.js";
import { uint16 } from "./uint16.js";
import { uint8 } from "./uint8.js";

export class GPU {
    parent: Gameboy;
    screen: ImageData;
    context: CanvasRenderingContext2D;
    mode = 2; // OAM Read is first step in GPU clock cycle
    clock = 0;
    line = 0;
    raster = 0;
    LCDOn = 0; // 0 or 1
    spritesOn = 0; // 0 or 1
    spritesLarge = 0; // 0 or 1 (0 = 8x8, 1 = 8x16)
    backgroundOn = 0; // 0 or 1
    backgroundMap = 0; // 0 or 1
    backgroundTileset = 0; // 0 or 1
    windowOn = 0; // 0 or 1
    windowTileset = 0; // 0 or 1
    palette: {
        background: [255, 192, 96, 0],
        object0: [255, 192, 96, 0],
        object1: [255, 192, 96, 0],
    };
    screenX = 0;
    screenY = 0;
    tileset: Array<Array<Array<number>>> = new Array(384).fill(new Array(8).fill(new Array(8).fill(0)));

    constructor(_parent: Gameboy){
        this.parent = _parent;
        this.reset();
    }

    reset(){
        this.context = this.parent.Screen.getContext('2d');
        this.screen = this.context.createImageData(160,144);
        this.screen.data.forEach((_,i,a) => a[i] = 255); // white screen
        this.context.putImageData(this.screen, 0, 0); // push to canvas
        this.mode = 0;
        this.clock = 0;
        this.line = 0;
        this.tileset = new Array(384).fill(new Array(8).fill(new Array(8).fill(0)));
        this.LCDOn = 0;
        this.spritesOn = 0;
        this.spritesLarge = 0;
        this.backgroundOn = 0;
        this.backgroundMap = 0;
        this.backgroundTileset = 0;
        this.windowOn = 0;
        this.windowTileset = 0;
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
        let map = this.backgroundMap ? 0x9C00 : 0x9800; // which map offset
        map += ((this.line + this.screenY) & 255) >> 3; // which line of tiles
        let line = this.screenX >> 3; // which tile to start with in line
        let y = (this.line + this.screenY) & 7; // which line of pixels
        let x = this.screenX & 7; // where in line
        let screenDataOffset = this.line*160*4; // 4 values per pixel (RGBA)
        let tile = this.parent.Memory.r8[map + line]; // tile index from background map
        if (this.backgroundTileset === 1 && tile < 128) tile+=256; // signed tile index to real tile index

        for (let i=0;i<160;i++){
            const color = this.palette.background[this.tileset[tile][y][x]]; // only allows single value for r, g, and b, consider expanding to array of separate rgb values in future
            this.screen.data[screenDataOffset] = color;
            this.screen.data[screenDataOffset+1] = color;
            this.screen.data[screenDataOffset+2] = color;
            this.screen.data[screenDataOffset+3] = 255; // alpha always 255
            screenDataOffset+=4;

            x++;
            if (x === 8){ // move to new tile
                x = 0;
                line = (line + 1) & 31;
                tile = this.parent.Memory.r8[map + line];
                if (this.backgroundTileset === 1 && tile < 128) tile+=256; // signed tile index to real tile index
            }
        }
    }

    updateTile(addr: uint16, m: uint8[]){
        const base = addr.value & 0x1FFE;
        const tile = (base >> 4) & 511;
        const y = (base >> 1) & 7;

        let sx;
        for (let x=0;x<8;x++){
            sx = 1 << (7-x);
            this.tileset[tile][y][x] = ((m[base].value & sx) ? 1 : 0) + ((m[base+1].value & sx) ? 2 : 0);
        }
    }
}