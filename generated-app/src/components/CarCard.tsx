import { Card, CardMedia, CardContent, Typography, Box, Chip } from "@mui/material";
import type { Car } from "@/types";

export interface CarCardProps {
  car: Car;
}

export function CarCard({ car }: CarCardProps) {
  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        boxShadow: 2,
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <CardMedia
        component="img"
        height="200"
        image={car.desktop || car.tablet || car.mobile}
        alt={`${car.year} ${car.make} ${car.model}`}
        sx={{ objectFit: "cover" }}
      />
      <CardContent sx={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: "bold" }}>
          {car.year} {car.make} {car.model}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: "auto" }}>
          <Typography variant="body2" color="text.secondary">
            Color:
          </Typography>
          <Chip
            label={car.color}
            size="small"
            variant="outlined"
            sx={{ textTransform: "capitalize" }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}

export default CarCard;