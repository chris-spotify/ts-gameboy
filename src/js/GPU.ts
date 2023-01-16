import { Gameboy } from "./Gameboy.js";

export class GPU {
    parent: Gameboy;

    constructor(_parent: Gameboy){
        this.parent = _parent;
    }
}