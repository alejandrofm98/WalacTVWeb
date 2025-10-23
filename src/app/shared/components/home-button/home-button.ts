import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-home-button',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home-button.html',
  styleUrls: ['./home-button.css']
})
export class HomeButton {}
