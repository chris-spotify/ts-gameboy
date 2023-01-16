import { CPU } from "./CPU.js";
import { Memory } from "./Memory.js";
import { GPU } from "./GPU.js";

export class Gameboy {
    CPU: CPU;
    Memory: Memory;
    GPU: GPU;
    Screen: HTMLCanvasElement;

    constructor(){
        this.GPU = new GPU(this); // GPU first, initialize vram memory range
        this.Memory = new Memory(this); // Memory 2nd, CPU relies on Memory existing, Memory relies on GPU vram memory existing
        this.CPU = new CPU(this); // CPU last
        this.Screen = document.getElementById("screen") as HTMLCanvasElement;
    }
}

const gameboy = new Gameboy();
console.log(gameboy);