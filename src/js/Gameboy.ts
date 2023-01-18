import { CPU } from "./CPU.js";
import { Memory } from "./Memory.js";
import { GPU } from "./GPU.js";
import { uint8 } from "./uint8.js";

export class Gameboy {
    CPU: CPU;
    Memory: Memory;
    GPU: GPU;
    Screen: HTMLCanvasElement;
    run: any; // interval

    constructor(){
        this.GPU = new GPU(this); // GPU first, initialize vram memory range
        this.Memory = new Memory(this); // Memory 2nd, CPU relies on Memory existing, Memory relies on GPU vram memory existing
        this.CPU = new CPU(this); // CPU last
        this.Screen = document.getElementById("screen") as HTMLCanvasElement;
        this.run = setInterval(this.frame.bind(this), 1); // gotta go fast! - sanic, 1992
    }

    frame(){
        try {
            const frameCycle = this.CPU.cycles + 17556; // cycles per frame
            while(this.CPU.cycles < frameCycle){
                
                if (this.CPU.halt) {
                    this.CPU.cycles++; // keep counting cycles while we're halted
                } else {
                    // do next op code
                    let opcode = this.Memory.r8(this.CPU.pc).value.toString(16);
                    if (opcode.length === 1) opcode = '0'+opcode;
                    this.CPU.ops[opcode]();
                }

                // check interrupts
                if (this.CPU.ime && this.Memory.ie && this.Memory.if){

                    this.CPU.halt = 0; // an interrupt wakes up from halt
                    this.CPU.ime = 0; // disable other interrupts temporarily (RETI will enable again)

                    // mask enabled interrupts against interrupt flags, break out into active RSTs for interrupt ladder
                    const {rst40, rst48, rst50, rst58, rst60} = this.getFiredInterrupts(new uint8(this.Memory.ie.value & this.Memory.if.value));
                    
                    // interrupt ladder
                    if (rst40){
                        this.Memory.if = new uint8(this.Memory.if.value & 0xFE); // unset flag
                        this.CPU.rst(0x40);
                    } else if (rst48){
                        this.Memory.if = new uint8(this.Memory.if.value & 0xFD); // unset flag
                        this.CPU.rst(0x48);
                    } else if (rst50){
                        this.Memory.if = new uint8(this.Memory.if.value & 0xFB); // unset flag
                        this.CPU.rst(0x50);
                    } else if (rst58){
                        this.Memory.if = new uint8(this.Memory.if.value & 0xF7); // unset flag
                        this.CPU.rst(0x58);
                    } else if (rst60){
                        this.Memory.if = new uint8(this.Memory.if.value & 0xEF); // unset flag
                        this.CPU.rst(0x60);
                    } else {
                        this.CPU.ime = 1; // enable interrupts again if we didn't hit a RST --> RETI
                    }
                }

                // check GPU drawing progress (draw lines to buffer based on cycle count)

                // check stop value (debugging, stop instruction, should kill run interval)
            }
        } catch(e){
            console.error(e, this.CPU.cycles, this.CPU.registers, this.CPU.flags);
            clearInterval(this.run);
        }
    }

    getFiredInterrupts(fired: uint8){
        return {
            rst40: !!(fired.value & 1),
            rst48: !!(fired.value & 2),
            rst50: !!(fired.value & 4),
            rst58: !!(fired.value & 8),
            rst60: !!(fired.value & 16),
        };
    }
}

const gameboy = new Gameboy();
console.log(gameboy);