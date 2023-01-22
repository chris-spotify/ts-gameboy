import { CPU } from "./CPU.js";
import { Memory } from "./Memory.js";
import { GPU } from "./GPU.js";
import { uint8 } from "./uint8.js";
import { uint16 } from "./uint16.js";

export class Gameboy {
    CPU: CPU;
    Memory: Memory;
    GPU: GPU;
    Screen: HTMLCanvasElement;
    run: any; // interval

    constructor(){
        this.Screen = document.getElementById("screen") as HTMLCanvasElement;
        this.GPU = new GPU(this); // GPU first, initialize vram memory range
        this.Memory = new Memory(this); // Memory 2nd, CPU relies on Memory existing, Memory relies on GPU vram memory existing
        this.CPU = new CPU(this); // CPU last
        this.CPU.debug = true;
        const input = document.getElementById("game") as HTMLInputElement;
        input.addEventListener('change', () => { this.loadCartridge(input); });
    }

    async loadCartridge(input: HTMLInputElement)
    {
        const file = input.files[0];
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        for (let i=0;i<bytes.length;i++){
            this.Memory.w8(new uint16(i), new uint8(bytes[i]));
        }
        this.run = setInterval(this.frame.bind(this), 1); // gotta go fast! - sanic, 1992
    }

    frame(){
        try {
            const frameCycle = this.CPU.cycles + 17556; // cycles per frame
            while(this.CPU.cycles < frameCycle){
                const startCycles = this.CPU.cycles;
                if (this.CPU.halt) {
                    this.CPU.cycles++; // keep counting cycles while we're halted
                } else {
                    // do next op code
                    const opcode = this.Memory.r8(this.CPU.pc).value.toString(16).padStart(2,'0').toUpperCase();
                    this.CPU.ops[opcode]();
                    if (this.CPU.debug)
                        console.log(`
                        opcode: ${opcode}, ${this.CPU.debugLogs.pop()}, 
                        flags: ${JSON.stringify(this.CPU.flags)},
                        BC: ${this.CPU.registers.bc.value.value.toString(16).padStart(4, '0')},
                        DE: ${this.CPU.registers.de.value.value.toString(16).padStart(4, '0')},
                        HL: ${this.CPU.registers.hl.value.value.toString(16).padStart(4, '0')},
                        SP: ${this.CPU.sp.value.toString(16).padStart(4, '0')},
                        PC: ${this.CPU.pc.value.toString(16).padStart(4, '0')},
                        A: ${this.CPU.registers.a.value.value.toString(16).padStart(2, '0')}, 
                        B: ${this.CPU.registers.b.value.value.toString(16).padStart(2, '0')}, 
                        C: ${this.CPU.registers.c.value.value.toString(16).padStart(2, '0')},
                        D: ${this.CPU.registers.d.value.value.toString(16).padStart(2, '0')},
                        E: ${this.CPU.registers.e.value.value.toString(16).padStart(2, '0')},
                        H: ${this.CPU.registers.h.value.value.toString(16).padStart(2, '0')},
                        L: ${this.CPU.registers.l.value.value.toString(16).padStart(2, '0')},
                        `);
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
                const instructionCycles = this.CPU.cycles - startCycles;
                this.GPU.draw(instructionCycles);

                // check stop value (debugging, stop instruction, should kill run interval)
                if (this.CPU.stop) throw new Error('CPU Stopped.');
            }
        } catch(e){
            console.error(e, this.CPU.cycles, this.CPU.registers, this.CPU.flags, this.CPU.ime, this.Memory.ie, this.Memory.if);
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