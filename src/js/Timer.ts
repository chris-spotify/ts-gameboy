import { Gameboy } from "./Gameboy.js";
import { uint8 } from "./uint8.js";

export class Timer {
    parent: Gameboy;
    div: uint8;
    tma: uint8;
    tima: uint8;
    tac: uint8;
    clock: {
        main: uint8;
        sub: uint8;
        div: uint8;
    }

    constructor(_parent: Gameboy) {
        this.parent = _parent;
        this.reset();
    }

    reset() {
        this.div = new uint8(0);
        this.tma = new uint8(0);
        this.tima = new uint8(0);
        this.tac = new uint8(0);
        this.clock = {
            main: new uint8(0),
            sub: new uint8(0),
            div: new uint8(0),
        };
    }

    step() {
        this.tima.inc();
        this.clock.main.value = 0;
        if (this.tima.value === 0) { // overflow
            this.tima.value = this.tma.value; // set to timer start value (tma)
            this.parent.Memory.if.value = this.parent.Memory.if.value | 4; // set timer overflow interrupt
        }
    }

    inc(instructionCycles: number) {
        this.clock.sub.inc(instructionCycles);
        if (this.clock.sub.value > 3) {
            this.clock.main.inc();
            this.clock.sub.dec(4);
            this.clock.div.inc();

            if (this.clock.div.value === 16) {
                this.clock.div.value = 0;
                this.div.inc();
                this.div.value = this.div.value & 255;
            }
        }

        if (this.tac.value & 4) {
            switch (this.tac.value & 3) {
                case 0:
                    if (this.clock.main.value >= 64) this.step();
                    break;
                case 1:
                    if (this.clock.main.value >= 1) this.step();
                    break;
                case 2:
                    if (this.clock.main.value >= 4) this.step();
                    break;
                case 3:
                    if (this.clock.main.value >= 16) this.step();
                    break;
            };
        }
    }
}