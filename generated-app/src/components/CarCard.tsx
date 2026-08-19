import { Card, CardContent, CardMedia, Typography, Box } from "@mui/material";
import type { Car } from "@/types";

export interface CarCardProps {
  car: Car;
}

export function CarCard({ car }: CarCardProps) {
  const imageUrl = car.desktop || car.tablet || car.mobile || "";

  return (
    <Card sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {imageUrl && (
        <CardMedia
          component="img"
          height="200"
          image={imageUrl}
          alt={`${car.year} ${car.make} ${car.model}`}
        />
      )}
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          {car.make} {car.model}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Year: {car.year}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Color: {car.color}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}

export default CarCard;